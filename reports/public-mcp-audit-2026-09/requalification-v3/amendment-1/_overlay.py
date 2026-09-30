"""The six amended copies, by the frozen path each one stands in for (AMENDMENT.md)."""
import hashlib
import os

HERE = os.path.dirname(os.path.abspath(__file__))
REPORT = os.path.abspath(os.path.join(HERE, "..", ".."))


def _sha(path):
    with open(path, "rb") as fh:
        return hashlib.sha256(fh.read()).hexdigest()


def overlay():
    """Frozen absolute path -> overlay absolute path, after checking both digests."""
    mapping = {}
    with open(os.path.join(HERE, "overlay.sha256")) as fh:
        for line in fh:
            original_digest, copy_digest, relative = line.split()
            original = os.path.join(REPORT, relative)
            copy = os.path.join(HERE, "overlay", relative.replace("/", "_"))
            if _sha(original) != original_digest:
                raise SystemExit(f"REFUSING: {relative} no longer matches the digest recorded with the amendment")
            if _sha(copy) != copy_digest:
                raise SystemExit(f"REFUSING: the overlay copy of {relative} changed after the amendment was written")
            mapping[original] = copy
    return mapping
