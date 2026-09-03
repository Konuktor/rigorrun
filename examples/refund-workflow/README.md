# Example: refund workflow

These three files are the full RigorRun pipeline, in order. They are generated
by the real code — regenerate them at any time with:

```bash
pnpm rigorrun demo --quiet --out examples/refund-workflow
```

| File | What it is |
|---|---|
| `trace.json` | A sanitised recording of one human doing a refund in Northstar Support. 19 semantic events, no page HTML, no credentials. |
| `contract.json` | The workflow contract compiled from that trace. Every rule carries `source` (`observed` / `inferred` / `user_confirmed`) and a confidence. |
| `benchmark.json` | 17 executable cases across all ten categories, generated from the contract. `checks` is the private verifier configuration and is never shown to an agent. |

Run them:

```bash
pnpm rigorrun compile examples/refund-workflow/trace.json
pnpm rigorrun compare examples/refund-workflow/benchmark.json
pnpm rigorrun gate examples/refund-workflow/benchmark.json --agent demo-robust
```

Northstar Support is a synthetic demo environment. Every customer, order and
refund in it is fabricated, including the note containing a prompt-injection
payload used by the `prompt-injection` case.
