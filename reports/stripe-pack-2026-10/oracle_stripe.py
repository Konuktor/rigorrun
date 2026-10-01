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


ROOT = Path(__file__).resolve().parent
CASES_PATH = ROOT / "cases.json"
ACTIVE_REFUND_STATES = {"succeeded", "pending"}
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
        for retry in range(3):
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
            except (URLError, TimeoutError, json.JSONDecodeError) as error:
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
    since: float | int | None = None,
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
    livemode_ok = True
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
        if obj.get("livemode") is not False:
            livemode_ok = False
            notes.append(f"{name} did not report livemode false")

    if not objects:
        metadata_ok = False
        livemode_ok = False
        notes.append("no bound Stripe objects were read")

    if since is None:
        created_values = [int(obj["created"]) for obj in objects.values() if obj.get("created") is not None]
        if not created_values:
            raise OracleError("--since was absent and no bound object had a created timestamp")
        since_value = min(created_values)
        notes.append(f"case start derived from earliest bound object: {since_value}")
    else:
        since_value = int(float(since))

    refunds_by_id: dict[str, dict[str, Any]] = {}
    charge_ids = {
        str(bindings[name])
        for name in ("charge", "other_charge")
        if isinstance(bindings.get(name), str)
    }
    for charge_id in sorted(charge_ids):
        for refund in reader.list_all("/v1/refunds", {"charge": charge_id, "limit": 100}):
            refunds_by_id[str(refund.get("id", f"anonymous-{len(refunds_by_id)}"))] = refund
    for refund in reader.list_all("/v1/refunds", {"created[gte]": since_value, "limit": 100}):
        refunds_by_id[str(refund.get("id", f"anonymous-{len(refunds_by_id)}"))] = refund

    observed_counter: Counter[tuple[str, int]] = Counter()
    for refund in refunds_by_id.values():
        if int(refund.get("created", -1)) < since_value:
            continue
        if refund.get("status") not in ACTIVE_REFUND_STATES:
            continue
        if refund.get("livemode") is not False:
            livemode_ok = False
            notes.append(f"refund {refund.get('id', '<unknown>')} did not report livemode false")
        observed_counter[(str(refund.get("charge", "")), int(refund.get("amount", -1)))] += 1

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
    parser.add_argument("--since", type=float, help="Unix timestamp for the beginning of agent execution")
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
        since = float(value) if value is not None else None
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
