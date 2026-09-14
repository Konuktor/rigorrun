#!/usr/bin/env python3
"""Renders remediation/before-after.md from its template and the generated results.

Every number is written as a marker that aggregate-after.mjs --check verifies:
  {{KEY}}        -> <!-- n:KEY -->value<!-- /n -->                (after-results.json, AFTER-2)
  {{a1:KEY}}     -> <!-- n-after-1:KEY -->value<!-- /n-after-1 --> (after-1-results.json)
  {{n1:KEY}}     -> <!-- n1:KEY -->value<!-- /n1 -->               (n1/results.json, N-1; checked by n1/scripts/aggregate-n1.mjs --check)
KEY is a dotted path through the JSON, as the checker flattens it. A key that is
missing, or that names an object or a list, stops the render: a number the
results do not contain is never written.

Two blocks are built from the same files, not typed: {{CASE_TABLE}} (every
RigorRun-mode case, BEFORE / AFTER-1 / AFTER-2) and {{NOT_RUN}} (AFTER-2 cases
without a recorded attempt).

  render-before-after.py            # write before-after.md
  render-before-after.py --template PATH
"""
import json
import os
import re
import sys

sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.abspath(__file__))
REMEDIATION = os.path.dirname(HERE)
TEMPLATE = os.path.join(HERE, "before-after.template.md")
if "--template" in sys.argv:
    TEMPLATE = sys.argv[sys.argv.index("--template") + 1]


def flatten(value, prefix="", out=None):
    out = {} if out is None else out
    if isinstance(value, dict):
        for key, item in value.items():
            flatten(item, f"{prefix}.{key}" if prefix else key, out)
    else:
        out[prefix] = value
    return out


after = json.load(open(os.path.join(REMEDIATION, "after-results.json")))
after1 = json.load(open(os.path.join(REMEDIATION, "after-1-results.json")))
manifest = json.load(open(os.path.join(REMEDIATION, "baseline-manifest.json")))
flat = flatten(after)
flat1 = flatten(after1)
N1_RESULTS = os.path.join(REMEDIATION, "n1", "results.json")
flatn1 = flatten(json.load(open(N1_RESULTS))) if os.path.exists(N1_RESULTS) else {}


def render_value(key, table, tag):
    if key not in table:
        raise SystemExit(f"{tag}:{key} is not in the results; refusing to write it")
    value = table[key]
    if isinstance(value, (list, dict)):
        raise SystemExit(f"{tag}:{key} is a {type(value).__name__}, not a number")
    text = "null" if value is None else ("true" if value is True else "false" if value is False else str(value))
    return f"<!-- {tag}:{key} -->{text}<!-- /{tag} -->"


def case_table():
    first = {c["id"]: c for c in after1["cases"]}
    final = {c["id"]: c for c in after["cases"]}
    rows = ["| Case | Oracle (AFTER-2) | BEFORE | AFTER-1 | AFTER-2 outcome-aware | AFTER-2 original rule |", "| --- | --- | --- | --- | --- | --- |"]
    for frozen in manifest["cases"]:
        if frozen["mode"] != "rigorrun":
            continue
        one, two = first[frozen["id"]], final[frozen["id"]]
        oracle = ",".join(two["oracleVerdicts"]) or "not run"
        rows.append(f"| `{frozen['id']}` | {oracle} | {frozen['classification']} | {one['outcomeClassification']} | {two['outcomeClassification']} | {two['classification']} |")
    return "\n".join(rows)


def not_run():
    ids = [entry["id"] for entry in after["NOT_RUN_CASES"]]
    return ", ".join(f"`{i}`" for i in ids) if ids else "none"


def present(key):
    """A block's key is present when the results hold a non-null value or object there."""
    node = after
    for part in key.split("."):
        if not isinstance(node, dict) or node.get(part) is None:
            return False
        node = node[part]
    return True


def external_missing():
    defined = [c["id"] for c in json.load(open(os.path.join(REMEDIATION, "heldout", "external", "cases.json")))]
    path = os.path.join(REMEDIATION, "heldout", "results-external.json")
    recorded = {c["id"] for c in json.load(open(path))["cases"] if c.get("actual") != "NOT_RUN"} if os.path.exists(path) else set()
    missing = [i for i in defined if i not in recorded]
    return ", ".join(f"`{i}`" for i in missing) if missing else "none"


text = open(TEMPLATE).read()
text = re.sub(r"\{\{#if ([^}]+)\}\}(.*?)\{\{/if\}\}", lambda m: m.group(2) if present(m.group(1)) else "", text, flags=re.S)
text = re.sub(r"\{\{#unless ([^}]+)\}\}(.*?)\{\{/unless\}\}", lambda m: "" if present(m.group(1)) else m.group(2), text, flags=re.S)
text = text.replace("{{CASE_TABLE}}", case_table()).replace("{{NOT_RUN}}", not_run()).replace("{{HELDOUT_EXTERNAL_MISSING}}", external_missing())
text = re.sub(r"\{\{a1:([^}]+)\}\}", lambda m: render_value(m.group(1), flat1, "n-after-1"), text)
text = re.sub(r"\{\{n1:([^}]+)\}\}", lambda m: render_value(m.group(1), flatn1, "n1"), text)
text = re.sub(r"\{\{([^}]+)\}\}", lambda m: render_value(m.group(1), flat, "n"), text)
open(os.path.join(REMEDIATION, "before-after.md"), "w").write(text)
print(f"before-after.md rendered: {text.count('<!-- n:')} AFTER-2 markers, {text.count('<!-- n-after-1:')} AFTER-1 markers, {text.count('<!-- n1:')} N-1 markers")
