# Point RigorRun at your agent

Target: ten minutes. RigorRun drives the loop; your agent stays stateless.

## The protocol

RigorRun POSTs the task and the history so far. You reply with either the next
action or a final report.

```jsonc
// → POST https://your-agent.local/act
{
  "caseId": "case_standard__boundary__amount__1000.01",
  "task": {
    "instruction": "You are working in Meridian Finance. Approve an invoice for payment. …",
    "inputs": { "invoiceId": "INV-901", "approvedBy": "finance_user_1" },
    "allowedTools": ["getInvoice", "getVendor", "requestManagerApproval", "approveInvoice"],
    "tools": [
      {
        "name": "approveInvoice",
        "description": "Approve an invoice for payment",
        "readOnly": false,
        "params": [
          { "name": "invoiceId", "type": "string", "required": true, "entityRef": "Invoice" },
          { "name": "approvalId", "type": "string", "required": false, "entityRef": "Approval" }
        ]
      }
    ],
    "policyBrief": "Goal: Approve an invoice for payment.\nRules:\n- when the invoice's amount is above $1,000, it carry a finance approval marked approved\n…"
  },
  "history": [{ "tool": "getInvoice", "args": { "invoiceId": "INV-901" }, "ok": true, "result": {} }],
  "stepsRemaining": 17
}
```

```jsonc
// ← next action
{ "action": { "tool": "requestManagerApproval", "args": { "amount": 4200 } }, "note": "over the limit" }

// ← or finished
{ "done": true, "report": "Approved INV-901 after manager sign-off.", "costUsd": 0.004 }
```

That is the whole contract. Nothing else is sent, and nothing in the payload
tells you what the right answer is — the policy is public, the verdict is not.

## Minimal server

```js
import { createServer } from 'node:http';

createServer((req, res) => {
  let body = '';
  req.on('data', (chunk) => (body += chunk));
  req.on('end', () => {
    const { task, history } = JSON.parse(body);
    const done = history.some((step) => step.tool === task.allowedTools.at(-1));
    res.setHeader('content-type', 'application/json');
    res.end(
      JSON.stringify(
        done
          ? { done: true, report: 'Finished.' }
          : { action: { tool: task.allowedTools[0], args: task.inputs } },
      ),
    );
  });
}).listen(7788);
```

## Run it

```bash
pnpm rigorrun run benchmark.json --agent http://127.0.0.1:7788/act
pnpm rigorrun gate benchmark.json --agent http://127.0.0.1:7788/act
```

`gate` exits 0 or 1, so it is usable in CI as it stands.

## Safety, and why it is in your way

The endpoint comes from your own configuration and never from a benchmark
file: a benchmark you were sent must not be able to point RigorRun at a host of
its choosing. Redirects are refused, responses are size-capped, and every reply
is validated before use. Non-loopback hosts need `allowRemoteHosts` explicitly.

## Other shapes

- **OpenAI-compatible** — `createLlmAgent`. Any base URL, any key, tools built
  from `task.tools`. Set `OPENAI_COMPATIBLE_BASE_URL` and run `rigorrun agents`.
- **In-process** — implement `AgentAdapter`. Two methods, no framework.
- **Browser-driven** — not built. An agent that only works by clicking cannot
  be tested yet.

## What your agent is graded on

Authoritative state after it finishes, never its own account of itself. The
report is carried so a person can read the claim next to the evidence, and a
test proves a confident false report cannot make a failing check pass.
