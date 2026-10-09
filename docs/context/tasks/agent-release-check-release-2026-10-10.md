# Agent Release Check · publication preparation

- Agent: Codex root; no implementation workers unless a selected workflow requires them.
- Base: `7692615e83baea27f4cec1fff90f0afdc619345b`, completed local Agent Release Check MVP.
- Worktree: `/home/erbol/.codex/worktrees/104e/RigorRun`.
- Branch: `feat/agent-release-check-release`.
- Authority: the founder's follow-up requests a full check and publication, site/docs and demo updates only after everything is ready. This replaces the prior cycle's no-publication limit; it does not authorize unrelated product features, qualification work, outreach or real production agent actions.

## Goal and design

Prepare a patch release of the existing workflow, without redesign or engine changes. Preserve current public-site positioning and historical recorded evidence. Add a clear first-run guide for the real Helpdesk UI, truthful source/release status, and a real-interface demo. Proposed next npm version is `0.6.1`; `0.6.0` is already published and immutable. Historical qualification covers its recorded tree, not this changed package tree.

## Allowed files

- This brief and a new `docs/product/AGENT_RELEASE_CHECK_RELEASE.md` verification ledger.
- `e2e/a11y.spec.ts`, `e2e/critical.spec.ts`: align consent-dependent navigation with the existing `deepLinkToVerdict` helper; retain accessibility/evidence assertions.
- `e2e/__screenshots__/visual.spec.ts-snapshots/**`: only individually inspected intentional changes from the existing bundled examples; no enlarged tolerances or hidden regions.
- `packages/cli/package.json`, `packages/cli/src/help.ts`, `packages/core/src/index.ts`, `action.yml`: release version only. Inspection found two constants asserted against the manifest by `packages/cli/test/package.test.ts`; update all three together, without engine logic changes.
- `README.md`, `docs/CI.md`, `docs/product/AGENT_RELEASE_CHECK_QUICKSTART.md`.
- `apps/docs/src/content/docs/start/helpdesk.md`, `apps/docs/src/content/docs/start/ci-gate.md`, a new `apps/docs/src/content/docs/start/agent-release-check.md`, and narrow docs navigation registration in `apps/docs/astro.config.mjs`.
- `apps/site/src/pages/index.astro`, `apps/site/src/pages/start.astro`, `apps/site/src/pages/what-is-built.astro`, `apps/site/public/llms.txt`: existing-layout copy, links, version/availability disclosures and real demo embed only.
- `apps/site/public/media/agent-release-check*`: newly prepared MP4/WebM/poster assets; keep existing historical demo assets.
- `apps/site/src/data/proof.json`: existing proof generator output, reviewed as synthetic pipeline evidence, never a qualification.
- New isolated video project under a temporary `videos/rigorrun-release-check/` directory. Video workflow frame workers may write only their assigned frame files.

## Forbidden

Never edit `reports/**`, qualification harnesses, preregistrations, `CLAIMS.md`, `POSITIONING.md`, `PROGRESS.md`, or unrelated user worktrees. No copied dirty edits, secret values, new paid resources, SaaS, live candidate writes or gate weakening. No deletion of tracked assets. Preserve all existing worktrees.

## Acceptance and publication gate

Investigate each fresh release failure before fixing. Run targeted accessibility and cross-browser checks, inspect changed visual comparisons, then rerun visual checks without update mode. Run `pnpm lint`, `pnpm typecheck`, `pnpm claims`, `pnpm release:verify`, `pnpm verify:package`, clean installed-package Helpdesk acceptance and browser onboarding. Check site/docs at desktop and mobile widths, and demo playback, asset budget, links and console errors. A skipped browser is disclosed, not counted as a pass. Video uses the mandatory HyperFrames brief and final-preview approval gates.

Only after all required checks and review are complete: normal GitHub integration and existing trusted npm publishing workflow; verify the published artifact through a fresh install. Deploy only the existing site/docs Cloudflare projects, then run production read-only checks. No premature tag, npm publish or deployment.

## Handoff

Record exact tested SHAs, commands, exits, retained artifacts, changed paths and outstanding items. A green local MVP is not a green release. Any package version or code change makes the tree differ from historical qualification; do not claim requalification. If any required gate remains incomplete, do not publish or call the release ready.
