---
title: Agent Release Check
description: Review the Helpdesk rules, connect your own HTTP agent, inspect system evidence and repeat the same local suite before a release.
---

Check an HTTP agent against the bundled, two-organisation Helpdesk twin. Review
every proposed rule explicitly, run the candidate, and inspect task completion
and policy compliance separately. Evidence comes from the twin's state, access
log and outbox, not the agent's claim of success.

This path is available in `rigorrun@0.6.1`. It is local and simulated, not a
hosted runner or a connection to your live helpdesk. A PASS covers only the
checked scenarios and reviewed boundaries. Historical qualification at 0.6.0
does not cover this changed code tree.

## 1. Start the twin

Use Node 22. In a terminal, leave the twin running:

```bash
npx rigorrun@0.6.1 helpdesk twin --port 12113
```

Configure your agent's MCP URL as `http://127.0.0.1:12113/mcp`. The public
synthetic credential `tok_alder_support` is scoped to Alder Outdoor;
`tok_service` deliberately sees every organisation. Use the scope your candidate
actually uses. Each case resets the twin's synthetic world. Never point this
exercise at production.

## 2. Connect your own HTTP agent

Your endpoint must accept a probe without doing work:

```json
{ "protocol": "rigorrun/task/1", "probe": true }
```

Return `{"ok":true}`. Normal requests contain `task.text`, `task.instruction`,
`task.inputs` and `task.policyBrief`. Finish the work before returning the final
JSON reply, for example `{"output":"Refund completed."}`. A 202 response is not
completion under the default mode. See [black-box agents](/agents/black-box/)
for request templates and completion options.

In another terminal:

```bash
npx rigorrun@0.6.1 --no-open
```

Open the one-time pairing URL printed by the runner. From Projects:

1. Create a project and select **Helpdesk twin**.
2. Enter the local MCP URL and explicitly select local/ephemeral safety.
3. Confirm or reject every proposed rule. Pending rules keep the suite unready;
   rejected boundaries are not enforced.
4. Add your HTTP endpoint as a black-box agent. Set the claim path to the field
   in your reply (`output` above). Probe the agent; a failed probe remains failed.
5. Run the suite and inspect each case's task and policy results, observed
   records, access log and outbox. Save the run JSON.
6. Reload the saved project and repeat. Changed configuration does not turn an
   old PASS into a result for the new setup.

Readiness says the suite can be used by the gate. It is not agent health or an
agent-safety verdict. Missing required readback is unknown/inconclusive, not PASS.

## 3. Produce the report and release gate

Use one writer per project. Wait for pending work, then stop the local daemon
with Ctrl+C before CLI writes or runs against the same home. The twin and your
agent stay running. Use one browser tab for mutations; the UI lock does not span
tabs, page reloads or other processes.

Use the project ID from the browser:

```bash
npx rigorrun@0.6.1 gate --project <id> --agent <name> --report first.html --json
npx rigorrun@0.6.1 gate --project <id> --agent <name> --report repeat.html --json
npx rigorrun@0.6.1 compare-runs --project <id> <run-id> --json
```

If you chose a custom `--home`, pass that same home to these commands. The report
includes expandable PASS and FAIL details. Full reports contain local workflow
data; review them before sharing. Redaction does not make arbitrary prose safe.

| Exit | Meaning |
| --- | --- |
| `0` | The candidate passed this suite and gate. |
| `1` | Candidate task/policy failure or a missed threshold. |
| `2` | Configuration or runtime error. |
| `3` | Inconclusive evidence or a missing, stale, unreviewed or refused suite. |

The gate never silently assesses or repairs a suite. Generated suites still
need current, adequate quality evidence. Keep the default thresholds unless
you deliberately intend a different release policy.

Use the [existing GitHub Action](/start/ci-gate/) with a configured project home,
running twin and candidate on your CI worker. It runs the same gate and preserves
all four exits. The public site does not host that worker or execute your agent.

For a reproducible scripted control, local source build and artifact acceptance,
see the [repository quickstart](https://github.com/Konuktor/rigorrun/blob/master/docs/product/AGENT_RELEASE_CHECK_QUICKSTART.md).
Scripted controls are test equipment, not validation of a live model.
