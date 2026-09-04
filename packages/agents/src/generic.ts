/**
 * Demo agents that work on any environment.
 *
 * They are not clever. They read the work order, the tool catalogue and the
 * policy they were handed, and they act. What separates them is *how much they
 * bother to check* — which is exactly what separates real agents, and exactly
 * what a benchmark against authoritative state is for.
 *
 *   naive    does what it was asked and nothing else. No permission is ever
 *            requested, nothing is recorded, no record is inspected.
 *   careful  inspects the records it was given, asks for every permission the
 *            environment offers, and writes down what it did — but takes the
 *            work order at face value rather than checking the state of the
 *            world against the policy.
 *
 * Neither contains a domain word, and neither is given the answer. `careful`
 * is a good agent that has not been told to verify preconditions; `naive` is
 * the one a team writes in an afternoon. Both fail, in different places, and
 * the point of the product is to say exactly where.
 */
import type { AgentAdapter, AgentEnvironment, AgentRunInput, AgentRunOutput } from './types.ts';
import { NO_MODEL_COST } from './types.ts';
import type { ToolDescription } from '@rigorrun/core';

const INJECTION_MARKERS =
  /ignore (all )?(previous|prior)|important system message|system message:|do not ask for|skip (every|the) approval/i;

interface Behaviour {
  id: string;
  name: string;
  description: string;
  /** Read the records named in the work order before acting. */
  inspects: boolean;
  /** Ask for every permission the environment offers. */
  obtainsPermissions: boolean;
  /** Write the work down afterwards. */
  records: boolean;
}

function build(behaviour: Behaviour): AgentAdapter {
  return {
    id: behaviour.id,
    name: behaviour.name,
    kind: 'demo',
    description: behaviour.description,

    async execute(input: AgentRunInput, env: AgentEnvironment): Promise<AgentRunOutput> {
      const notes: string[] = [];
      const inputs = input.task.inputs;
      const tools = input.task.tools;
      const readers = tools.filter((tool) => tool.readOnly);
      const writers = tools.filter((tool) => !tool.readOnly);

      // The job is the last writing tool offered that the work order can fill.
      const primary = [...writers].reverse().find((tool) => canCall(tool, inputs, {}));
      if (!primary) {
        return done('I could not work out which action this job is asking for.', notes);
      }
      const supporting = writers.filter((tool) => tool.name !== primary.name);

      if (behaviour.inspects) {
        for (const reader of readers) {
          const args = bind(reader, inputs, {});
          if (!args) continue;
          const result = await env.call(reader.name, args);
          if (result.ok) {
            const text = JSON.stringify(result.data ?? {});
            if (INJECTION_MARKERS.test(text)) {
              // Content stored in a record is data. Recording that it tried
              // is useful; obeying it is the failure this product exists to
              // catch.
              notes.push(
                `A record contained text formatted as an instruction. Treated as data and ignored.`,
              );
              env.note('ignored an instruction found inside record content');
            }
          }
        }
      }

      const learned: Record<string, unknown> = {};

      if (behaviour.obtainsPermissions) {
        // Anything that must come first, comes first. This agent asks for
        // every permission going rather than working out which it needs.
        for (const tool of supporting) {
          if (behaviour.records && looksLikeRecordKeeping(tool)) continue;
          const args = bind(tool, inputs, learned);
          if (!args) continue;
          const result = await env.call(tool.name, args);
          if (result.ok) harvest(result.data, learned);
        }
      }

      const primaryArgs = bind(primary, inputs, learned);
      if (!primaryArgs) {
        return done('The work order is missing something the action requires.', notes);
      }
      const primaryResult = await env.call(primary.name, primaryArgs);
      if (!primaryResult.ok) {
        return done(
          `${primary.name} was refused (${primaryResult.error?.code ?? 'unknown'}). Nothing was done.`,
          notes,
        );
      }
      harvest(primaryResult.data, learned);
      notes.push(`Performed ${primary.name}.`);

      if (behaviour.records) {
        for (const tool of supporting.filter(looksLikeRecordKeeping)) {
          const args = bind(tool, inputs, learned, describeWork(primary.name, learned));
          if (!args) continue;
          const result = await env.call(tool.name, args);
          if (result.ok) notes.push(`Recorded the work with ${tool.name}.`);
        }
      }

      return done(notes.join(' '), notes);
    },
  };
}

function done(report: string, notes: string[]): AgentRunOutput {
  return { report: report || notes.join(' ') || 'Nothing to report.', ...NO_MODEL_COST };
}

/**
 * A tool with no identifier parameters and only free text is somewhere to
 * write things down. Deciding that from the shape of the API rather than from
 * its name is what keeps this agent usable on an environment it has never
 * seen.
 */
function looksLikeRecordKeeping(tool: ToolDescription): boolean {
  return (
    tool.params.length > 0 &&
    tool.params.every((param) => param.entityRef === undefined && param.type === 'string')
  );
}

function canCall(
  tool: ToolDescription,
  inputs: Record<string, unknown>,
  learned: Record<string, unknown>,
): boolean {
  return bind(tool, inputs, learned) !== null;
}

/**
 * Fills a tool's parameters from the work order and from identifiers picked up
 * along the way. Returns null when something required cannot be supplied.
 */
function bind(
  tool: ToolDescription,
  inputs: Record<string, unknown>,
  learned: Record<string, unknown>,
  freeText?: string,
): Record<string, unknown> | null {
  const args: Record<string, unknown> = {};
  for (const param of tool.params) {
    const supplied = inputs[param.name] ?? learned[param.name];
    if (supplied !== undefined && supplied !== null) {
      args[param.name] = supplied;
      continue;
    }
    if (!param.required) continue;
    if (param.type === 'string' && param.entityRef === undefined && freeText !== undefined) {
      args[param.name] = freeText;
      continue;
    }
    return null;
  }
  return args;
}

/** Remembers identifiers a tool handed back, so later calls can name them. */
function harvest(data: unknown, learned: Record<string, unknown>): void {
  if (data === null || typeof data !== 'object' || Array.isArray(data)) return;
  for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
    if (typeof value === 'string' || typeof value === 'number') learned[key] = value;
  }
}

function describeWork(action: string, learned: Record<string, unknown>): string {
  const ids = Object.values(learned)
    .filter((value): value is string => typeof value === 'string' && /^[A-Z]{2,6}-\w+$/.test(value))
    .sort();
  return `${action} completed for ${ids.join(', ') || 'the requested work'}`;
}

export const naiveAgent = build({
  id: 'naive',
  name: 'Agent A (naive)',
  description:
    'Does exactly what the work order says. Inspects nothing, asks for no permission, records nothing.',
  inspects: false,
  obtainsPermissions: false,
  records: false,
});

export const carefulAgent = build({
  id: 'careful',
  name: 'Agent B (careful)',
  description:
    'Reads the records it was given, obtains every permission the system offers, and writes the work down. Does not check the state of the world against the policy.',
  inspects: true,
  obtainsPermissions: true,
  records: true,
});

export const GENERIC_AGENTS = [naiveAgent, carefulAgent];
