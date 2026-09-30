"""Shared by the post-release regression runs: where a release's evidence goes, and which product it is.

A release after 0.3.0 re-runs the three regression inputs of requalification v3 — IO-v1, IO-v2 and
the in-process held-out set — at the release commit. The committed runners are imported unmodified;
only where they write evidence and project homes, and how they identify the product, are replaced.
The product is the committed HEAD, with nothing uncommitted under the product paths, and its
packages/cli/package.json version must be the version named on the command line.
"""
import json
import os
import subprocess
import sys

sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.abspath(__file__))
REPORT = os.path.abspath(os.path.join(HERE, ".."))
REPO = os.path.abspath(os.path.join(REPORT, "..", ".."))
RQ = os.path.join(REPORT, "requalification-v3")
PRODUCT_PATHS = ["packages", "apps/app", "fixtures"]


def version_from_argv():
    if len(sys.argv) < 3:
        raise SystemExit(f"usage: {os.path.basename(sys.argv[0])} <version> <command> [args]")
    version = sys.argv[1]
    del sys.argv[1]
    return version


def evidence_dir(version, name):
    return os.path.join(HERE, version, name)


def make_verify_product(version):
    def verify_product():
        head = subprocess.run(["git", "-C", REPO, "rev-parse", "HEAD"], capture_output=True, text=True, check=True).stdout.strip()
        dirty = subprocess.run(["git", "-C", REPO, "status", "--porcelain", "--", *PRODUCT_PATHS], capture_output=True, text=True, check=True).stdout.strip()
        if dirty:
            raise SystemExit(f"REFUSING: uncommitted changes under the product paths:\n{dirty}")
        with open(os.path.join(REPO, "packages", "cli", "package.json")) as fh:
            shipped = json.load(fh)["version"]
        if shipped != version:
            raise SystemExit(f"REFUSING: packages/cli/package.json is {shipped}, not {version}")
        return head
    return verify_product
