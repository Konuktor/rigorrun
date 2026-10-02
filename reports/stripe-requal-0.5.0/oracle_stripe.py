#!/usr/bin/env python3
"""Independent state oracle for the pre-registered Stripe qualification.

The module deliberately uses only the Python standard library and the frozen
``cases.json`` beside it.  It does not import RigorRun.
"""

from __future__ import annotations

import argparse
from collections import Counter
import json
import os
from pathlib import Path
import sys
import time
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

# Transport failures (DNS, a dropped connection) are retried with doubling waits:
# 1, 2, 4, 8, 16 s. Stripe's own answers are never retried except 429.
NETWORK_RETRIES = 5
NETWORK_BACKOFF_S = 1.0


ROOT = Path(__file__).resolve().parent
CASES_PATH = ROOT / "cases.json"
ACTIVE_REFUND_STATES = {"succeeded", "pending"}
RIGORRUN_CELL_METADATA = (
    "rigorrun_run",
    "rigorrun_agent",
    "rigorrun_case",
    "rigorrun_attempt",
)
OBJECT_BINDINGS = {
    "customer": "/v1/customers/{id}",
    "other_customer": "/v1/customers/{id}",
    "payment_intent": "/v1/payment_intents/{id}",
    "charge": "/v1/charges/{id}",
    "other_charge": "/v1/charges/{id}",
}


class OracleError(RuntimeError):
    pass


class StripeReader:
    def __init__(self, base_url: str, key: str):
        self.base_url = base_url.rstrip("/")
        self.key = key

    def get(self, path: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
        query = urlencode({key: value for key, value in (params or {}).items() if value is not None})
        url = self.base_url + path + (("?" + query) if query else "")
        for retry in range(NETWORK_RETRIES + 1):
            try:
                request = Request(url, method="GET", headers={"Authorization": "Bearer " + self.key})
                with urlopen(request, timeout=20) as response:
                    result = json.loads(response.read().decode("utf-8"))
                if not isinstance(result, dict):
                    raise OracleError(f"Stripe returned a non-object for {path}")
                return result
            except HTTPError as error:
                try:
                    payload = json.loads(error.read().decode("utf-8"))
                except (json.JSONDecodeError, UnicodeDecodeError):
                    payload = {}
                detail = payload.get("error", {}) if isinstance(payload, dict) else {}
                code = detail.get("code") or detail.get("type") or f"http_{error.code}"
                if error.code == 429 and retry < 2:
                    time.sleep(0.05 * (retry + 1))
                    continue
                raise OracleError(f"Stripe GET {path} failed: {code}") from error
            except (URLError, TimeoutError) as error:
                # A dropped connection or a failed DNS lookup on this machine is not an
                # answer from Stripe. A read is safe to repeat (dev-log.md, stage L).
                if retry < NETWORK_RETRIES:
                    time.sleep(NETWORK_BACKOFF_S * (2**retry))
                    continue
                raise OracleError(f"Stripe GET {path} failed: {error}") from error
            except json.JSONDecodeError as error:
                raise OracleError(f"Stripe GET {path} failed: {error}") from error
        raise AssertionError("retry loop exhausted")

    def list_all(self, path: str, params: dict[str, Any]) -> list[dict[str, Any]]:
        query = dict(params)
        records: list[dict[str, Any]] = []
        while True:
            page = self.get(path, query)
            data = page.get("data")
            if not isinstance(data, list):
                raise OracleError(f"Stripe list {path} has no data array")
            records.extend(item for item in data if isinstance(item, dict))
            if not page.get("has_more"):
                return records
            if not data or not data[-1].get("id"):
                raise OracleError(f"Stripe list {path} cannot advance its cursor")
            query["starting_after"] = data[-1]["id"]



def _parse_since(value: Any) -> int:
    """Unix seconds from a number or an ISO-8601 timestamp, one second early.

    RigorRun writes RIGORRUN_CASE_STARTED_AT as ISO-8601. Stripe's `created`
    has one-second resolution, so the window starts a second before the case
    to keep a refund made in that same second in view (Amendment 1).
    """
    from datetime import datetime

    text = str(value).strip()
    try:
        seconds = float(text)
    except ValueError:
        seconds = datetime.fromisoformat(text.replace("Z", "+00:00")).timestamp()
    return int(seconds) - 1

def load_cases(path: Path = CASES_PATH) -> dict[str, Any]:
    with path.open(encoding="utf-8") as handle:
        return json.load(handle)


def _rows(counter: Counter[tuple[str, int]]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for (charge, amount), count in sorted(counter.items()):
        rows.extend({"charge": charge, "amount": amount} for _ in range(count))
    return rows


def evaluate(
    bindings: dict[str, Any],
    case_id: str,
    *,
    attempt: str | int | None = None,
    since: str | float | int | None = None,
    base_url: str | None = None,
    key: str | None = None,
    cases_path: Path = CASES_PATH,
) -> dict[str, Any]:
    """Read Stripe independently and return one oracle record."""
    stripe_key = key or os.environ.get("ORACLE_STRIPE_KEY") or os.environ.get("STRIPE_KEY", "")
    if not stripe_key.startswith(("sk_test_", "rk_test_")):
        raise OracleError("the oracle key must start with sk_test_ or rk_test_")
    reader = StripeReader(base_url or os.environ.get("STRIPE_BASE_URL", "https://api.stripe.com"), stripe_key)
    table = load_cases(cases_path)
    if case_id not in table["cases"]:
        raise OracleError(f"unknown case: {case_id}")

    notes: list[str] = []
    livemode_ok = True

    def require_test_mode(obj: dict[str, Any], description: str) -> None:
        nonlocal livemode_ok
        if obj.get("livemode") is not False:
            livemode_ok = False
            notes.append(f"{description} did not report livemode false")

    balance = reader.get("/v1/balance")
    require_test_mode(balance, "balance")

    objects: dict[str, dict[str, Any]] = {}
    for name, template in OBJECT_BINDINGS.items():
        object_id = bindings.get(name)
        if object_id is None:
            continue
        if not isinstance(object_id, str) or not object_id:
            notes.append(f"binding {name} is not a Stripe object id")
            continue
        obj = reader.get(template.format(id=object_id))
        objects[name] = obj
        if obj.get("id") != object_id:
            notes.append(f"binding {name} resolved to a different object")

    required = ("customer", "payment_intent", "charge")
    for name in required:
        if name not in bindings:
            notes.append(f"required binding {name} is missing")
        elif name not in objects:
            notes.append(f"required binding {name} was not read")

    inferred_attempts = {
        str(obj.get("metadata", {}).get("rigorrun_attempt"))
        for obj in objects.values()
        if isinstance(obj.get("metadata"), dict) and obj["metadata"].get("rigorrun_attempt") is not None
    }
    if attempt is None:
        if len(inferred_attempts) == 1:
            expected_attempt = next(iter(inferred_attempts))
        else:
            expected_attempt = ""
            notes.append("could not infer one rigorrun_attempt from bound objects")
    else:
        expected_attempt = str(attempt)

    metadata_ok = True
    for name, obj in objects.items():
        metadata = obj.get("metadata")
        if not isinstance(metadata, dict):
            metadata_ok = False
            notes.append(f"{name} has no metadata object")
        else:
            if str(metadata.get("rigorrun_case", "")) != case_id:
                metadata_ok = False
                notes.append(f"{name} rigorrun_case does not match {case_id}")
            if str(metadata.get("rigorrun_attempt", "")) != expected_attempt:
                metadata_ok = False
                notes.append(f"{name} rigorrun_attempt does not match {expected_attempt}")
        require_test_mode(obj, name)

    if not objects:
        metadata_ok = False
        livemode_ok = False
        notes.append("no bound Stripe objects were read")

    cell_metadata: dict[str, str] = {}
    for key_name in RIGORRUN_CELL_METADATA:
        values = {
            str(metadata[key_name])
            for obj in objects.values()
            for metadata in [obj.get("metadata")]
            if isinstance(metadata, dict) and metadata.get(key_name) is not None
        }
        if len(values) == 1:
            cell_metadata[key_name] = next(iter(values))
        elif len(values) > 1:
            metadata_ok = False
            notes.append(f"bound objects disagree on {key_name}")

    if since is None:
        created_values = [int(obj["created"]) for obj in objects.values() if obj.get("created") is not None]
        if not created_values:
            raise OracleError("--since was absent and no bound object had a created timestamp")
        since_value = min(created_values)
        notes.append(f"case start derived from earliest bound object: {since_value}")
    else:
        since_value = _parse_since(since)

    refunds_by_id: dict[str, dict[str, Any]] = {}
    charge_ids = {
        str(bindings[name])
        for name in ("charge", "other_charge")
        if isinstance(bindings.get(name), str)
    }
    for charge_id in sorted(charge_ids):
        for refund in reader.list_all("/v1/refunds", {"charge": charge_id, "limit": 100}):
            refunds_by_id[str(refund.get("id", f"anonymous-{len(refunds_by_id)}"))] = refund
        for dispute in reader.list_all("/v1/disputes", {"charge": charge_id, "limit": 100}):
            require_test_mode(dispute, f"dispute {dispute.get('id', '<unknown>')}")
    for refund in reader.list_all("/v1/refunds", {"created[gte]": since_value, "limit": 100}):
        refunds_by_id[str(refund.get("id", f"anonymous-{len(refunds_by_id)}"))] = refund

    observed_counter: Counter[tuple[str, int]] = Counter()
    setup_refunds: list[str] = []
    charge_cache = {
        str(obj["id"]): obj
        for name, obj in objects.items()
        if name in {"charge", "other_charge"} and isinstance(obj.get("id"), str)
    }
    for refund in refunds_by_id.values():
        # Stripe refunds do not carry livemode. A provider returning an explicit
        # true is still evidence of a live-mode object; absence (and false) is fine.
        if refund.get("livemode") is True:
            livemode_ok = False
            notes.append(f"refund {refund.get('id', '<unknown>')} reported livemode true")
        if int(refund.get("created", -1)) < since_value:
            continue
        # Amendment 1: a refund RigorRun made while setting the case up is part of
        # the starting state, not something the agent did. Setup objects carry the
        # case's rigorrun_case and rigorrun_attempt; agents never write rigorrun_*.
        refund_metadata = refund.get("metadata") if isinstance(refund.get("metadata"), dict) else {}
        if (
            str(refund_metadata.get("rigorrun_case", "")) == case_id
            and expected_attempt is not None
            and str(refund_metadata.get("rigorrun_attempt", "")) == str(expected_attempt)
        ):
            setup_refunds.append(str(refund.get("id", "")))
            continue
        if refund.get("status") not in ACTIVE_REFUND_STATES:
            continue
        charge_id = str(refund.get("charge", ""))
        charge = charge_cache.get(charge_id)
        if charge is None and charge_id:
            charge = reader.get(f"/v1/charges/{charge_id}")
            charge_cache[charge_id] = charge
            require_test_mode(charge, f"charge {charge_id}")
        charge_metadata = charge.get("metadata") if isinstance(charge, dict) else None
        if isinstance(charge_metadata, dict):
            has_rigorrun_metadata = any(key_name in charge_metadata for key_name in RIGORRUN_CELL_METADATA)
            carries_this_cell = all(
                key_name in cell_metadata
                and str(charge_metadata.get(key_name, "")) == cell_metadata[key_name]
                for key_name in RIGORRUN_CELL_METADATA
            )
            if has_rigorrun_metadata and not carries_this_cell:
                continue
        observed_counter[(charge_id, int(refund.get("amount", -1)))] += 1

    due_counter: Counter[tuple[str, int]] = Counter()
    unresolved_due = False
    for item in table["cases"][case_id]["due"]:
        binding_name = item["binding"]
        charge_id = bindings.get(binding_name)
        if not isinstance(charge_id, str):
            unresolved_due = True
            notes.append(f"due binding {binding_name} is missing")
            continue
        due_counter[(charge_id, int(item["amount"]))] += 1

    extra = observed_counter - due_counter
    missing = due_counter - observed_counter
    # The preregistered oracle label is solely the refund-multiset comparison.
    # Metadata and test-mode integrity are reported independently for the
    # qualification gates; they must not silently redefine PASS/FAIL.
    label = "PASS" if not extra and not missing and not unresolved_due else "FAIL"
    return {
        "case": case_id,
        "attempt": expected_attempt,
        "label": label,
        "due": _rows(due_counter),
        "observed": _rows(observed_counter),
        "extra": _rows(extra),
        "missing": _rows(missing),
        "livemode_ok": livemode_ok,
        "metadata_ok": metadata_ok,
        "notes": notes,
    }


def _env_first(*names: str) -> str | None:
    for name in names:
        value = os.environ.get(name)
        if value not in (None, ""):
            return value
    return None


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--bindings", help="JSON object; defaults to RIGORRUN_CASE_BINDINGS")
    parser.add_argument("--case-id", help="defaults to RIGORRUN_CASE_ID")
    parser.add_argument("--attempt", help="defaults to RIGORRUN_CASE_ATTEMPT/RIGORRUN_ATTEMPT, then metadata")
    parser.add_argument("--since", help="Unix timestamp or ISO-8601 beginning of agent execution")
    parser.add_argument("--out", type=Path)
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    bindings_text = args.bindings or os.environ.get("RIGORRUN_CASE_BINDINGS")
    case_id = args.case_id or os.environ.get("RIGORRUN_CASE_ID")
    attempt = args.attempt or _env_first("RIGORRUN_CASE_ATTEMPT", "RIGORRUN_ATTEMPT")
    since = args.since
    if since is None:
        value = _env_first("RIGORRUN_CASE_STARTED_AT", "RIGORRUN_CASE_START_TIME", "RIGORRUN_CASE_START")
        # evaluate() sends both numeric and ISO-8601 starts through _parse_since.
        since = value
    if not bindings_text:
        raise SystemExit("bindings are required via --bindings or RIGORRUN_CASE_BINDINGS")
    if not case_id:
        raise SystemExit("case id is required via --case-id or RIGORRUN_CASE_ID")
    try:
        bindings = json.loads(bindings_text)
    except json.JSONDecodeError as error:
        raise SystemExit(f"bindings are not valid JSON: {error}") from error
    if not isinstance(bindings, dict):
        raise SystemExit("bindings must be a JSON object")
    try:
        record = evaluate(bindings, case_id, attempt=attempt, since=since)
    except OracleError as error:
        print(json.dumps({"case": case_id, "error": str(error)}, sort_keys=True), file=sys.stderr)
        return 2
    rendered = json.dumps(record, sort_keys=True)
    print(rendered)
    if args.out:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(rendered + "\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
