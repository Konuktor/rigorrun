#!/usr/bin/env node
/**
 * The whole RigorRun integration.
 *
 * Set RIGORRUN_AGENT_BEHAVIOUR=careless to ship the bug on purpose.
 */
import { defineAgent, serve } from '@rigorrun/agent-sdk';
import { CARELESS, CAREFUL, runTask } from './agent.ts';

const behaviour = process.env['RIGORRUN_AGENT_BEHAVIOUR'] === 'careless' ? CARELESS : CAREFUL;

const agent = defineAgent(
  async ({ task, environment }) => ({
    status: 'completed',
    output: await runTask(environment.mcpUrl, task.inputs, behaviour),
  }),
  { name: 'booking-agent', version: '1.0.0' },
);

const { url } = await serve(agent, { port: Number(process.env['PORT'] ?? 8900) });
process.stdout.write(`booking-agent listening on ${url}\n`);
