/**
 * Replaying the demonstrated job against a different world.
 *
 * This is the one piece of machinery that makes the rest generic. RigorRun
 * needs to know, for every generated case, what a compliant operator would
 * have done — and it must work that out without anybody writing a script per
 * workflow. So it replays the plan the operator actually performed, binding
 * each action's arguments from the case's own request, from records created
 * earlier in the same plan, and otherwise from what the operator used, with
 * identifiers substituted for the ones that exist now.
 *
 * The same executor is the reference agent. That is worth being explicit
 * about: an agent built from the demonstration will of course pass a benchmark
 * built from the demonstration, so it is evidence of *consistency*, not of
 * agent quality. The evidence that the benchmark discriminates comes from the
 * flawed agent, the injected defects and any agent brought from outside.
 */
import type { EnvironmentContract, ObservedFact } from '@rigorrun/core';
import {
  rowById,
  type ActionDefinition,
  type CanonicalState,
  type EntityRow,
  type EnvironmentAdapter,
} from '@rigorrun/environment';

export interface PlanStep {
  action: string;
  args: Record<string, unknown>;
}

export interface PlanRun {
  ok: boolean;
  steps: PlanStep[];
  /** Every argument actually used, merged. Feeds the rules that count per field. */
  bindings: Record<string, unknown>;
  failure?: { action: string; code: string; message: string };
}

/**
 * Identifiers the demonstration created, per entity, in a stable order. Used
 * to rewrite references the operator wrote by hand ("claim CLM-9001 filed")
 * so they name the record that exists in *this* case.
 */
export function demonstratedIds(contract: EnvironmentContract): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const fact of contract.observedFacts) {
    const [entity, id] = splitFactKey(fact);
    if (!entity || !id) continue;
    (out[entity] ??= []).push(id);
  }
  return out;
}

function splitFactKey(fact: ObservedFact): [string | undefined, string | undefined] {
  // Only creation facts key as `Entity.ID` with a row payload.
  if (typeof fact.value !== 'object' || fact.value === null || Array.isArray(fact.value)) {
    return [undefined, undefined];
  }
  const index = fact.key.indexOf('.');
  if (index < 0) return [undefined, undefined];
  return [fact.key.slice(0, index), fact.key.slice(index + 1)];
}

export async function runPlan(
  adapter: EnvironmentAdapter,
  contract: EnvironmentContract,
  request: Record<string, unknown>,
  actions: readonly string[],
): Promise<PlanRun> {
  const definitions = new Map(adapter.getActions().map((action) => [action.name, action]));
  const originals = demonstratedIds(contract);
  const createdSoFar: Record<string, string[]> = {};
  const idMap = new Map<string, string>();
  const steps: PlanStep[] = [];
  const bindings: Record<string, unknown> = { ...request };

  for (const name of actions) {
    const definition = definitions.get(name);
    if (!definition) {
      return { ok: false, steps, bindings, failure: { action: name, code: 'UNKNOWN_ACTION', message: `no action named ${name}` } };
    }

    const before = await adapter.getState();
    const subject = subjectRow(adapter, contract, request, before);
    const args = bindArgs(definition, contract, request, createdSoFar, idMap, before, subject);
    if (!args) {
      return {
        ok: false,
        steps,
        bindings,
        failure: { action: name, code: 'UNBOUND_PARAM', message: `could not work out the arguments for ${name}` },
      };
    }

    const result = await adapter.executeAction(name, args);
    steps.push({ action: name, args });
    if (!result.ok) {
      return {
        ok: false,
        steps,
        bindings,
        failure: {
          action: name,
          code: result.error?.code ?? 'FAILED',
          message: result.error?.message ?? 'the action was refused',
        },
      };
    }
    for (const [key, value] of Object.entries(args)) bindings[key] = value;

    // Learn the identifiers this step produced, so later steps can name them.
    const after = await adapter.getState();
    for (const entity of adapter.describeEntities().entities) {
      const wasThere = new Set(Object.keys(before.entities[entity.name] ?? {}));
      const fresh = Object.keys(after.entities[entity.name] ?? {})
        .filter((id) => !wasThere.has(id))
        .sort();
      for (const id of fresh) {
        const list = (createdSoFar[entity.name] ??= []);
        const original = originals[entity.name]?.[list.length];
        list.push(id);
        if (original && original !== id) idMap.set(original, id);
        bindings[entity.idField] = id;
      }
    }
  }

  return { ok: true, steps, bindings };
}

/**
 * Works out one action's arguments, in priority order:
 *
 *   1. the case's own request, by parameter name;
 *   2. a record created earlier in this same plan, for entity references;
 *   3. what the operator used, with identifiers rewritten.
 */
function bindArgs(
  definition: ActionDefinition,
  contract: EnvironmentContract,
  request: Record<string, unknown>,
  created: Record<string, string[]>,
  idMap: Map<string, string>,
  state: CanonicalState,
  subject: EntityRow | undefined,
): Record<string, unknown> | null {
  const demonstrated = contract.demonstratedArgs[definition.name] ?? {};
  const args: Record<string, unknown> = {};

  for (const param of definition.params) {
    if (Object.prototype.hasOwnProperty.call(request, param.name)) {
      const value = request[param.name];
      if (value !== undefined) {
        args[param.name] = value;
        continue;
      }
      // An explicit `undefined` in the request means "this case removes it".
      if (param.required) return null;
      continue;
    }

    if (param.entityRef) {
      const fresh = created[param.entityRef]?.at(-1);
      if (fresh !== undefined) {
        args[param.name] = fresh;
        continue;
      }
    } else {
      // A parameter named after a field of the record being worked on takes
      // that record's value. Without this, asking a manager to approve "the
      // amount" would ask about the amount from the recording rather than the
      // one in front of us, and every mutated case would fail for the wrong
      // reason.
      const onSubject = subject?.[param.name];
      if (onSubject !== undefined && onSubject !== null) {
        args[param.name] = onSubject;
        continue;
      }
    }

    const fallback = demonstrated[param.name];
    if (fallback === undefined) {
      if (param.required) return null;
      continue;
    }
    const rewritten = rewrite(fallback, idMap);
    // A demonstrated reference to a record this case does not have is worse
    // than nothing: it would silently act on the wrong row.
    if (param.entityRef && rowById(state, param.entityRef, rewritten) === undefined) {
      if (param.required) return null;
      continue;
    }
    args[param.name] = rewritten;
  }

  return args;
}

/** The record the work is about, as it stands right now. */
function subjectRow(
  adapter: EnvironmentAdapter,
  contract: EnvironmentContract,
  request: Record<string, unknown>,
  state: CanonicalState,
): EntityRow | undefined {
  const primary = adapter.getActions().find((action) => action.name === contract.primaryAction);
  const param = primary?.params.find((candidate) => candidate.entityRef === contract.focusEntity);
  if (!param) return undefined;
  const value = request[param.name];
  if (value === undefined || value === null) return undefined;
  return rowById(state, contract.focusEntity, value);
}

/** Rewrites identifiers inside a demonstrated value. */
function rewrite(value: unknown, idMap: Map<string, string>): unknown {
  if (idMap.size === 0) return value;
  if (typeof value === 'string') {
    let out = value;
    for (const [from, to] of idMap) out = replaceToken(out, from, to);
    return out;
  }
  if (Array.isArray(value)) return value.map((item) => rewrite(item, idMap));
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [
        key,
        rewrite(item, idMap),
      ]),
    );
  }
  return value;
}

/** Whole-token replacement, so `REF-1` never matches inside `REF-10`. */
function replaceToken(haystack: string, from: string, to: string): string {
  let out = '';
  let index = 0;
  for (;;) {
    const at = haystack.indexOf(from, index);
    if (at === -1) return out + haystack.slice(index);
    const before = at === 0 ? undefined : haystack[at - 1];
    const after = haystack[at + from.length];
    const bounded = !isIdentifierChar(before) && !isIdentifierChar(after);
    out += haystack.slice(index, at) + (bounded ? to : from);
    index = at + from.length;
  }
}

function isIdentifierChar(char: string | undefined): boolean {
  return char !== undefined && /[A-Za-z0-9_-]/.test(char);
}

/** Subsets of the remedies, shortest first, in a stable order. */
export function remedyPlans(remedies: readonly string[]): string[][] {
  const capped = remedies.slice(0, 4);
  const all: string[][] = [];
  for (let mask = 0; mask < 1 << capped.length; mask += 1) {
    all.push(capped.filter((_, index) => (mask & (1 << index)) !== 0));
  }
  return all.sort((a, b) => a.length - b.length || a.join(',').localeCompare(b.join(',')));
}
