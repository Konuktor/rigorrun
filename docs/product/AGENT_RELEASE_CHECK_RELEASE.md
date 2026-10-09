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
| Full release run on `b03a3cb3` | FAIL | All gates except E2E passed. E2E: 82 passed, one failed before reaching its rule assertions because Vite could not fetch the lazy DemoPage module. Retained `release-verify-b03a3cb3.log`; no automatic retry or test weakening. Investigate repeatability, then require a new full green run. |
| Focused failed-E2E diagnostic | PASS, not a substitute for full E2E | Ten repetitions, zero retries, all passed; traces retained under `rejected-rule-diagnostic/`. The observed dev-module fetch failure did not recur. No test assertion or runtime code changed to hide it. |
| Frozen full release rerun after review fixes | PASS | Tested `fcf407e090bf7f8a84c9406d528c15768067431c`, command `RIGORRUN_E2E_SHOTS=/tmp/rigorrun-release-audit-i3emcZ/final-shots pnpm release:verify`, exit 0. All 15 gates passed: 1,980 unit/integration passes and one existing conditional skip, 83 E2E, one external-user, two restart, 16 accessibility, 24 visual and six Chromium/Firefox critical tests. No test retries added; WebKit remains unavailable/unverified. `release-verify-final.log`. |
| Fresh `pnpm verify:package` | PASS | Exit 0, 649 KiB packed under the 700 KiB budget, clean install and packaged fresh-user journey passed; CycloneDX SBOM produced; zero critical/high/moderate installed dependency advisories. `verify-package-final.log`. It published nothing. |
| Exact final tarball installed acceptance | PASS | Clean installation at `/tmp/rigorrun-0.6.1-final-install-Nx4bgs`: 16 native HTTP checks, artifacts `/tmp/rigorrun-release-check-AC6Mph`, then 12 Helpdesk browser tests with zero retries. `final-installed-native.log` and `final-installed-browser.log`, combined exit 0. |
| Independent release source review | Approved | Original three findings and follow-up missing VERSION import resolved and independently checked at `fcf407e0`. No outstanding source-review issue. Review explicitly excludes incomplete video/deployment gates. |
| Local site/docs desktop/mobile | PASS | Built local site on 4311: 99 existing public-site tests, zero retries. Eighteen additional local page/viewport checks (1440/820/390) validated updated guides, persistence actions, internal links, overflow and zero browser errors. Screenshots/receipt retained in `pages/`. These are not production checks. |
| Video composition/preview | PASS | Six real-interface frames total 60s; strict HyperFrames check exit 0, browser ran, zero lint/runtime/layout/contrast findings or warnings; motion verification enabled with 300 samples. Snapshots around every cut and all six beats inspected. Studio at `http://localhost:3017/#project/rigorrun-release-check`, HTTP 200. |
| Final preview approval and encoded media | PASS | User explicitly approved: “Рендерить этот вариант”. HyperFrames render exit 0, `video-render.log`: 1,800 frames, 1920×1080, 30 fps, exactly 60.000s, no audio stream. Both H.264 MP4 and VP9 WebM fully decoded with ffmpeg without errors; encoded contact sheet inspected. Existing historical demo assets retained. |
| New website player, final rebuild | PASS | `media-local-final.log` and `media-local/receipt.json`: eight checks, H.264/VP9, 1440/820/390, reduced-motion manual Play including keyboard, native Pause/Resume, seek and zero errors. An early native-coordinate diagnostic clicked the seek bar, not Play; screenshot-grounded coordinates fixed the diagnostic without weakening its assertions. Separately restoring the original reduced-motion listener reproduced the empty-source Play failure at the correct coordinates (`reduced-motion-original-reproduction.log`). The final explicit Play action loads only on user interaction and restores normal controls. Failed diagnostics remain retained, not counted as passes. |
| Final site/docs rebuild and regressions | PASS | `pnpm lint`, `pnpm typecheck`, `pnpm claims`, site/docs builds exit 0. With the complete final assets and player: 99 existing site tests, zero retries (`site-local-final.log`), plus 18 page/viewport checks (`local-pages-final.log` / `pages/receipt.json`). Mobile final player screenshot inspected. |
| Local final performance, run alone | PASS | `perf-local.log`, exit 0: 18 passes and two intentional mobile duplicate-metric skips. Three cold samples per desktop metric; original LCP/FCP/TTFB/CLS and 600,000-byte transfer budgets unchanged. These are local results, not production measurements. |
| Independent final media/site review | Approved for normal integration | No outstanding critical, important or actionable minor findings. Independently checked asset digests, metadata, full decode, truthful captions, reduced-motion source and final player/site/performance receipts. Does not approve unperformed registry/deployment/production checks or establish Safari/live-model qualification. |

The demo uses independent **scripted controls**, a **simulated Helpdesk twin**, and only the checked scenarios. It does not show a qualified live LLM or establish production safety. Full reports can contain workflow data and require privacy review before sharing; only synthetic demo data is intended for the website.

Final local tarball: `dist/rigorrun-0.6.1.tgz`, SHA-256 `99e62c35df1a6526f1b04c9272b03a9e1b87058660e3219e930349223c8d431e`. This is a local artifact digest, not an npm registry digest or publication receipt. The verifier regenerated eleven historical fresh-user screenshots; copies are retained in `package-generated-shots/`, and only those verifier-owned mutations were restored to their committed versions. No unrelated checkout or user edit was reverted.

## Publication gates

Only after every required local check, review and final-video gate passes: integrate through the normal GitHub path, publish `0.6.1` through the existing trusted npm workflow, verify a fresh registry installation, deploy only the existing `rigorrun` and `rigorrun-docs` Cloudflare projects, then run read-only production checks. CRM and OPS are out of scope. Any incomplete gate keeps publication blocked.

The frozen package SHA and local digest above identify what was actually tested. Later generated-proof, ledger and video/site-only edits do not extend historical qualification. Registry receipts and production URLs will be recorded when publication/deployment actually happen. Until all remaining site, review and publication gates complete, neither the release nor updated public site is ready.

## Final website media

New assets under `apps/site/public/media/`; the original `demo.*` files remain unchanged:

| Asset | Bytes | SHA-256 |
| --- | ---: | --- |
| `agent-release-check.mp4` | 3,068,297 | `048083ce9445681a3cb13b639345e18fc7cdd2a0297c4af80c1e0071bcb38cbf` |
| `agent-release-check.webm` | 1,758,174 | `037b05f457aca3fa048d429e1a7161aefda020e25faf7b760a336476acf035f3` |
| `agent-release-check-poster.webp` | 56,586 | `13d3781260c601f10fe5ea0f69a0c286b3a88da671ccfec4f00830c88b6d0738` |

MP4 is stream-copied from the approved master with fast-start metadata, not a new composition. WebM and poster are derived from that same approved render. Preview/frame work used the workflow's inline fallback; no native frame agents were spawned. Only synthetic encoded assets are staged for the website, not the full local reports or capture receipts.
