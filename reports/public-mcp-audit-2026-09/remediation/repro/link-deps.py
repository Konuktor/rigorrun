#!/usr/bin/env python3
"""Gives a pre-fix worktree working dependencies without installing anything.

Third-party packages are linked from the main checkout (the lockfile is
unchanged, so they are identical). Workspace packages (@rigorrun/*) are linked
to the WORKTREE's own sources, so old code never imports new code through a
pnpm workspace symlink. Nothing in the main checkout is modified.

    link-deps.py <main-repo> <worktree>
"""
import os
import sys

main, wt = (os.path.realpath(p) for p in sys.argv[1:3])
WORKSPACE_SCOPE = "@rigorrun"


def node_modules_dirs(root):
    for dirpath, dirnames, _ in os.walk(root):
        rel = os.path.relpath(dirpath, root)
        if rel.startswith(("tmp", ".git", "reports")):
            dirnames[:] = []
            continue
        if "node_modules" in dirnames:
            yield os.path.join(rel, "node_modules")
            dirnames.remove("node_modules")
        dirnames[:] = [d for d in dirnames if not d.startswith(".")]


def remap(target):
    """A link into the main checkout's sources points at the worktree's instead."""
    real = os.path.realpath(target)
    if real.startswith(main + os.sep) and os.sep + "node_modules" + os.sep not in real[len(main):]:
        return wt + real[len(main):]
    return real


linked = remapped = 0
for rel in node_modules_dirs(main):
    src, dst = os.path.join(main, rel), os.path.join(wt, rel)
    if not os.path.isdir(os.path.dirname(dst)):
        continue  # this package does not exist at the pre-fix commit
    os.makedirs(dst, exist_ok=True)
    for entry in os.listdir(src):
        s, d = os.path.join(src, entry), os.path.join(dst, entry)
        if os.path.lexists(d):
            continue
        if entry == WORKSPACE_SCOPE and os.path.isdir(s):
            os.makedirs(d, exist_ok=True)
            for pkg in os.listdir(s):
                os.symlink(remap(os.path.join(s, pkg)), os.path.join(d, pkg))
                remapped += 1
            continue
        os.symlink(s, d)
        linked += 1
print(f"linked {linked} third-party entries, remapped {remapped} workspace packages to the worktree")
