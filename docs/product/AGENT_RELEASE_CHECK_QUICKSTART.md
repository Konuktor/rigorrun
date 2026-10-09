# Agent Release Check — local Helpdesk quickstart

Verify what your AI agents actually do. This local workflow checks a candidate
HTTP agent against the bundled Helpdesk twin, with rules you explicitly review,
and evidence from the twin's state, access log and outbox. A passing result covers
the checked scenarios and reviewed boundaries. It is not a hosted runner or a
security guarantee. Historical qualification does not cover this changed build.

## Build and install this local artifact

Use Node 22 and pnpm 11.7.0 in this delivery's checkout. This release candidate
prints `0.6.1`; it is not the historical published `0.6.0` package. Install the
tarball from this checkout while publication is pending. Check the
[release ledger](AGENT_RELEASE_CHECK_RELEASE.md) for verified publication status.

```sh
pnpm install --frozen-lockfile
pnpm build:app
pnpm build:cli
mkdir -p dist
npm pack ./packages/cli/package --pack-destination ./dist

rr_tarball=$(realpath dist/rigorrun-0.6.1.tgz)
rr_install_dir=$(mktemp -d /tmp/rigorrun-local-install-XXXXXX)
npm install --prefix "$rr_install_dir" --no-audit --no-fund "$rr_tarball"
rr_bin="$rr_install_dir/node_modules/.bin/rigorrun"
rr_home=$(mktemp -d /tmp/rigorrun-release-home-XXXXXX)
"$rr_bin" --version
```

Retain the absolute `rr_bin` and `rr_home` paths for the other terminals. Use the
same home for this project. Run one writer at a time; stop the daemon before CLI
mutations/runs against that home.
Use one browser tab for writes. The interface retains an in-flight project lock
across its own navigation, not across a page reload, another tab or another
process. Wait for any pending write/run to settle before reloading or changing
clients.

## Start the twin and your own agent

In one terminal, leave the newly installed CLI's twin running:

```sh
"$rr_bin" helpdesk twin --port 12113
```

Its MCP endpoint is `http://127.0.0.1:12113/mcp`. Each case replaces the twin's
synthetic world. Configure your candidate to use this twin. Do not point it at
production. The synthetic scoped fixture credential is `tok_alder_support`;
the deliberately overbroad fixture credential is `tok_service`. These public
fixture values are not private production credentials.

Your HTTP agent must answer a probe without performing work:

```json
{ "protocol": "rigorrun/task/1", "probe": true }
```

Return `{"ok":true}`. Normal POSTs contain `task.text`, `task.instruction`,
`task.inputs`, `task.policyBrief` and an optional principal. Finish work before
returning a final JSON reply such as `{"output":"..."}`. RigorRun does not receive
your internal reasoning or tool calls; it reads the twin afterwards. An HTTP
202 is not completion under the default response mode. The existing CLI also
supports body templates and poll/settle completion; see `agent add --help`.

For a reproducible model-free control, optionally start this independent fixture
from the repository root in another terminal:

```sh
node fixtures/external/helpdesk-release-control/server.mjs \
  --mcp http://127.0.0.1:12113/mcp --mode scoped --port 12114
```

This is scripted test equipment, not an LLM agent. It returns its claim under
`message`, so use that claim path in the interface/CLI. An actual agent release
decision requires your own candidate endpoint.

## Guided browser path

```sh
"$rr_bin" --home "$rr_home" --no-open
```

Open the one-time pairing URL printed by the local runner. In Projects, create
a project and select the Helpdesk twin path. Enter the local MCP URL and choose
local/ephemeral safety explicitly, then click **Connect twin and draft rules**.
Review every proposed rule: confirm or reject it. Click **Save decisions and
install suite** and wait for **Ready for the checked suite**. Pending rules keep
the suite unready. Rejected rules are not enforced; any
retained diagnostic checks do not prove that rejected boundary.

Connect your HTTP endpoint as a black-box agent and select the correct reply
field (`output` for the example contract, `message` for the optional control).
A failed probe remains failed. Readiness means the suite can be used by the
release gate; it is not agent health or a safety verdict. Run, inspect each case's
task and policy results, observed state/access/outbox, and save the run JSON.
Reload and repeat using the saved project. The HTML report is produced by the
CLI command below; the browser does not run shell commands.

## CLI equivalent, report, repeat and gate

Stop the daemon with Ctrl+C first. The twin and your agent remain running.
The CLI initializer asks you to confirm/reject each rule:

```sh
"$rr_bin" helpdesk init --twin http://127.0.0.1:12113/mcp --home "$rr_home"
```

Copy the printed project ID. If you already created/reviewed a project in the
browser, use its ID and skip initialization. `helpdesk init --yes` is an explicit
decision to confirm every proposed rule; use it only when that is your decision.

```sh
rr_project=p_REPLACE_WITH_YOUR_PROJECT_ID
"$rr_bin" agent add --project "$rr_project" --home "$rr_home" \
  --name my-agent --black-box http://127.0.0.1:12114/ --claim-path message

"$rr_bin" gate --project "$rr_project" --home "$rr_home" \
  --agent my-agent --report "$rr_home/first.html" --json

"$rr_bin" gate --project "$rr_project" --home "$rr_home" \
  --agent my-agent --report "$rr_home/repeat.html" --json

"$rr_bin" projects --home "$rr_home" --json
"$rr_bin" compare-runs --project "$rr_project" --home "$rr_home" RUN_ID --json
```

Substitute your endpoint and claim path for a real candidate. If the browser
already registered it, skip `agent add`. Reports are self-contained local HTML;
PASS and FAIL details explain checked assertions and available system evidence.
Task completion and policy compliance remain separate. Missing required readback
produces unknown/inconclusive evidence. Historical reports remain historical
after changing a connection, contract or suite.
Full reports contain local workflow data; do not upload them blindly. The
existing published report mode removes private evidence, but review any artifact
before sharing it. Redaction is not a guarantee that arbitrary prose is safe.

Gate exits: `0` passed; `1` candidate/task/policy failure; `2` configuration or
runtime error; `3` inadequate/stale/unreviewed suite or inconclusive evidence.
The project gate never silently assesses or repairs a suite. Generated suites
still require current adequate quality evidence. Keep the default thresholds.

The existing root `action.yml` reuses this gate and maps all four exits. While
publication is pending, use its existing `cli` input with the locally installed
executable and the configured project home. This candidate pins `0.6.1`; the
release ledger records whether the npm package and action tag actually exist.
The runner/twin/candidate and project need to exist on the CI worker. This
workflow does not start a cloud CI service.

## Fresh acceptance with the installed artifact

```sh
node scripts/agent-release-check-acceptance.mjs --binary "$rr_bin"
RIGORRUN_BIN="$rr_bin" pnpm exec playwright test \
  --config e2e/playwright.helpdesk.config.ts --workers=1 --retries=0
```

The first command starts its own ephemeral twin/daemon, isolated store and
independent HTTP controls, checks real boundary failures and gate exits, repeats
after daemon restart, then stops its own processes. It prints a fresh `/tmp`
artifact directory containing HTML, JSON, command/exit evidence and comparison.
Controls use live public task inputs, not hidden assertions or expected verdicts.
The browser command exercises the actual installed daemon and bundled interface.
See [AGENT_RELEASE_CHECK_DELIVERY.md](AGENT_RELEASE_CHECK_DELIVERY.md) for this
delivery's exact SHA, fresh results and remaining limits.
