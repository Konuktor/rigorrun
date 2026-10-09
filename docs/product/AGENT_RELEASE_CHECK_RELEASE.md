# Agent Release Check · 0.6.1 release verification

Status: **publication pending**. No npm tag, GitHub integration or site/docs deployment has been performed in this release cycle. This ledger does not supersede historical qualification or claim a new qualification.

## Scope and source

The implementation base is `7692615e83baea27f4cec1fff90f0afdc619345b`. Preparation is on `feat/agent-release-check-release` in the isolated `104e` worktree; the original dirty checkout and other worktrees are preserved. The release brief is [the task contract](../context/tasks/agent-release-check-release-2026-10-10.md). The patch changes version, consent-aware regression tests, inspected visual baselines, documentation, generated synthetic proof and the website demo. No new provider qualification or real-system agent write is authorized.

## Fresh verification, 2026-10-10

Logs are retained under `/tmp/rigorrun-release-audit-i3emcZ` on this machine.

| Check | Result | Evidence / limitation |
| --- | --- | --- |
| Initial `pnpm release:verify` | FAIL | Unit tests: 1,980 passed, one existing conditional skip; E2E: 83 passed; external client: one passed; restart: two passed. Accessibility and cross-browser tests contained stale automatic-consent navigation; 15 visual baselines predated the reviewed workflow. The redundant failing cross-browser run was interrupted, not counted as passing. |
| Consent-aware `pnpm a11y` | PASS | 16 tests; accessibility assertions retained. |
| Consent-aware `pnpm cross` | PASS within tested browsers | Six tests across Chromium and Firefox. WebKit is unavailable because required host libraries are missing; it is not verified. |
| Visual comparisons and update | Inspected | All 15 changed desktop/tablet/mobile images inspected against existing behavior. No tolerance increase or hidden regions. The update run itself is not the verification. |
| Subsequent `pnpm visual` | PASS | 24 tests without update mode, `visual-green.log`. |
| Clean local `0.6.1` tarball install | PASS | `/tmp/rigorrun-0.6.1-install-qAcqhE`; installed binary reports `0.6.1`. This is not a registry install. |
| Installed native HTTP acceptance | PASS | 16 checks, `installed-native-0.6.1.log`; `/tmp/rigorrun-release-check-P1BkWq`. Includes honest scoped/overbroad/refusal controls and exit codes 0/1/2/3. |
| Installed Helpdesk browser onboarding | PASS | 12 tests, `installed-browser-0.6.1.log`. |
| Real demo source capture | PASS | `/tmp/rigorrun-media-9w96XW/videos/rigorrun-release-check/capture/receipt.json`: real installed UI, six explicitly reviewed rules, scoped PASS, overbroad FAIL, reload and repeat; zero captured browser errors. Real CLI gate exits 0 and 1 verified separately after stopping the daemon. |
| Frozen full release rerun | Pending | Must pass after the fixes. |
| Fresh `pnpm verify:package` | Pending | Includes package budget, clean install, SBOM and dependency advisories. |
| Independent release review | Pending | Required before publication. |
| Site/docs desktop/mobile and demo playback | Pending | Required before deployment. |
| Final video preview approval and render | Pending | User approved the 60-second English, horizontal, silent format, not the final render. |

The demo uses independent **scripted controls**, a **simulated Helpdesk twin**, and only the checked scenarios. It does not show a qualified live LLM or establish production safety. Full reports can contain workflow data and require privacy review before sharing; only synthetic demo data is intended for the website.

## Publication gates

Only after every required local check, review and final-video gate passes: integrate through the normal GitHub path, publish `0.6.1` through the existing trusted npm workflow, verify a fresh registry installation, deploy only the existing `rigorrun` and `rigorrun-docs` Cloudflare projects, then run read-only production checks. CRM and OPS are out of scope. Any incomplete gate keeps publication blocked.

Exact frozen SHA, final package digest, final commands, video duration and production URLs will be recorded here when those steps actually complete. Until then, neither the release nor updated public site is ready.
