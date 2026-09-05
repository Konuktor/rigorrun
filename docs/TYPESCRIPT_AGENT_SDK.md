# TypeScript agent SDK

One function and a server. Deliberately not a framework: the moment this offers
a loop, a memory or a tool abstraction it is competing with the thing it exists
to measure, and every opinion it takes narrows what can honestly be measured.

```ts
import { defineAgent, serve } from '@rigorrun/agent-sdk';
import { myExistingAgent } from './agent.ts';

const agent = defineAgent(
  async ({ task, environment }) => ({
    status: 'completed',
    // Point whatever you already have at environment.mcpUrl.
    output: await myExistingAgent.run(task.instruction, environment.mcpUrl),
  }),
  { name: 'booking-agent', version: '1.0.0' },
);

await serve(agent, { port: 8900 });
```

That is the whole integration. What you get for free is the part that is
tedious and easy to get subtly wrong: the probe RigorRun uses to check you are
there, request validation, error shaping, a body limit, and loopback by
default.

## What your handler receives

```ts
interface AgentTaskRequest {
  caseId: string;
  task: {
    instruction: string;                 // the job, in the operator's words
    inputs: Record<string, unknown>;     // what this case is about
    policyBrief: string;                 // the rules, deliberately public
  };
  environment: {
    mcpUrl: string;                      // scoped to this case, and expiring
    expiresAt: string;
  };
  maxSteps: number;                      // exceeding it ends the case
}
```

## What it returns

```ts
interface AgentResult {
  status: 'completed' | 'failed';
  output?: string;                       // recorded, shown, never scored
  usage?: { promptTokens: number; completionTokens: number };
  costUsd?: number | null;
}
```

## Throwing is allowed

An agent that throws has failed the case, which is a result. The SDK reports it
as one and puts the reason in the evidence, rather than turning one bad case
into a broken benchmark run.

## A worked example

`fixtures/external/booking-agent` is a complete agent that speaks MCP, owns its
loop, and touches RigorRun only in `src/main.ts`. It is also the agent the
dogfood test breaks on purpose, to check RigorRun notices.
