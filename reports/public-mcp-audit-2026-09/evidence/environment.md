# Audit environment

Recorded 2026-09-13T19:06:00Z.

## RigorRun under test

| Item | Value |
|---|---|
| Repository | Konuktor/rigorrun (local clone) |
| Branch | redesign/brand-site-product |
| Commit | 07dda8c738d6daada161ffcf2bfc046b3c874ac5 |
| Working tree at start | clean (git status) |
| Package version (packages/cli/package.json) | 0.2.0 |
| Implementation exercised | repository sources at this commit, run with `pnpm rigorrun` (tsx). The packed tarball dist/rigorrun-0.2.0.tgz is the same version number; it was not re-packed for this audit. |

## Host

| Item | Value |
|---|---|
| OS | Linux 6.19.14+kali-amd64 x86_64 GNU/Linux |
| Node | v22.22.2 |
| npm | 12.0.1 |
| pnpm | 11.7.0 |
| Python | Python 3.13.12 |
| uv | uv 0.11.14 (x86_64-unknown-linux-gnu) |
| Docker | Docker version 28.5.2+dfsg4, build 9cc6dea35e9a963f281434761c656fba4ac43aed |
| Ollama | ollama version is 0.23.2 |
| rustc/cargo on host | none (Rust target built inside rust:1-bookworm container) |
| sqlite3 CLI | none (Python sqlite3 module used for the oracle) |

## Upstream targets (pinned)

| Target | Repository | Commit | Commit date |
|---|---|---|---|
| email-mcp | sandraschi/email-mcp | fef2a06e9313aa69e7fd1572e18c53ccfc082bcc | 2026-09-11T18:02:39+02:00 |
| worktide-mcp | Worktide-IO/worktide-mcp | 4dbd0851b8c16b7acf32e1ea45a1234c425cd19e | 2026-07-10T15:00:21+02:00 |
| worktide | Worktide-IO/worktide | 07393173732835c12c4cf763d73860fd82068ae0 | 2026-08-01T22:47:55+02:00 |
| sqlite-mcp | 0xOmarA/mcp-server-sqlite | ff19c64e40b68df83b07e22c2faf73094ab04aeb | 2026-04-04T21:20:21+03:00 |

## Baseline commands

```
git rev-parse HEAD
pnpm test    # see rigorrun-test-baseline.log
git clone https://github.com/<repo> tmp/rigorrun-audit/<target> && git checkout <commit>
```
