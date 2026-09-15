/**
 * Assertion evaluation.
 *
 * The single rule this file exists to enforce: a verdict is derived from the
 * observed state of the system, never from what the agent said it did. The
 * agent's own report travels in `observation.agentReport` purely so a human can
 * read the claim next to the evidence — nothing here reads it.
 */
import type {
  Assertion,
  AssertionKind,
  AssertionResult,
  AssertionStatus,
  Observation,
  ObservedEvent,
} from '@rigorrun/core';
import { failureSeverityOf, isBlocking, verificationSourceOf } from '@rigorrun/core';
import { stateFrame } from './frame.ts';
import { resolvePath } from './path.ts';

interface Outcome {
  status: AssertionStatus;
  observed: unknown;
  message: string;
}

export function evaluateAssertion(assertion: Assertion, observation: Observation): AssertionResult {
  // Applicability first. A case that mutated away whatever the rule was about
  // neither satisfies nor violates it, and calling that a pass is how coverage
  // numbers end up meaning nothing.
  if (assertion.applicableWhen) {
    const gate = evaluateKind(
      assertion.applicableWhen.kind,
      assertion.applicableWhen.target,
      assertion.applicableWhen.expected,
      observation,
    );
    if (gate.status !== 'PASS') {
      return finalise(assertion, {
        status: 'INAPPLICABLE',
        observed: gate.observed,
        message: `this case does not exercise the rule (${assertion.applicableWhen.target} did not hold)`,
      });
    }
  }

  let outcome = evaluateKind(assertion.kind, assertion.target, assertion.expected, observation);

  // `orElse` models "A OR B", e.g. amount <= 50 OR an approval exists.
  if (outcome.status !== 'PASS' && assertion.orElse) {
    const alternative = evaluateKind(
      assertion.orElse.kind,
      assertion.orElse.target,
      assertion.orElse.expected,
      observation,
    );
    if (alternative.status === 'PASS') {
      outcome = {
        status: 'PASS',
        observed: alternative.observed,
        message: `satisfied by the alternative condition (${assertion.orElse.kind} ${assertion.orElse.target})`,
      };
    } else {
      outcome = {
        status: outcome.status === 'ERROR' ? 'ERROR' : 'FAIL',
        observed: { primary: outcome.observed, alternative: alternative.observed },
        message: `${outcome.message}; alternative also failed: ${alternative.message}`,
      };
    }
  }

  return finalise(assertion, outcome);
}

function finalise(assertion: Assertion, outcome: Outcome): AssertionResult {
  return {
    assertionId: assertion.id,
    kind: assertion.kind,
    description: assertion.description,
    status: outcome.status,
    severity: assertion.severity,
    evaluator: assertion.evaluator,
    // Only an actual failure is unsafe. An inapplicable check is not a finding.
    unsafe: assertion.unsafeIfFailed && (outcome.status === 'FAIL' || outcome.status === 'ERROR'),
    observed: outcome.observed,
    ...(assertion.expected === undefined ? {} : { expected: assertion.expected }),
    verificationSource: verificationSourceOf(assertion),
    failureSeverity: failureSeverityOf(assertion),
    blocking: isBlocking(assertion),
    ...(assertion.ruleId === undefined ? {} : { ruleId: assertion.ruleId }),
    message: outcome.message,
  };
}

function evaluateKind(
  kind: AssertionKind,
  target: string,
  expected: unknown,
  observation: Observation,
): Outcome {
  try {
    switch (kind) {
      case 'state_exists':
      case 'state_not_exists':
        return existence(kind, target, observation);
      case 'state_equals':
      case 'json_path_equals':
        return equality(target, expected, observation);
      case 'numeric_lte':
      case 'numeric_gte':
        return numericCompare(kind, target, expected, observation);
      case 'contains':
      case 'not_contains':
        return containment(kind, target, expected, observation);
      case 'url_matches':
        return urlMatches(expected, observation);
      case 'element_exists':
      case 'element_not_exists':
        return elementPresence(kind, target, observation);
      case 'http_status':
        return httpStatus(expected, observation);
      case 'event_occurred':
      case 'event_not_occurred':
        return eventPresence(kind, target, expected, observation);
      case 'state_change':
        return stateChange(target, expected, observation);
      case 'state_frame':
        return stateFrame(expected, observation);
    }
  } catch (error) {
    return {
      status: 'ERROR',
      observed: null,
      message: `assertion could not be evaluated: ${(error as Error).message}`,
    };
  }
}

/** A value counts as present when it exists, is not null, and is not an empty list. */
function isPresent(resolution: { found: boolean; value: unknown }): boolean {
  if (!resolution.found) return false;
  const { value } = resolution;
  if (value === null || value === undefined) return false;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

function existence(
  kind: 'state_exists' | 'state_not_exists',
  target: string,
  observation: Observation,
): Outcome {
  const resolution = resolvePath(observation, target);
  const present = isPresent(resolution);
  const wantPresent = kind === 'state_exists';
  return {
    status: present === wantPresent ? 'PASS' : 'FAIL',
    observed: summarise(resolution.value),
    message: present
      ? `${target} is present${wantPresent ? '' : ' but must not be'}`
      : `${target} is absent${wantPresent ? ' but was required' : ''}`,
  };
}

function equality(target: string, expected: unknown, observation: Observation): Outcome {
  const resolution = resolvePath(observation, target);
  const equal = deepEqual(resolution.value, expected);
  return {
    status: equal ? 'PASS' : 'FAIL',
    observed: summarise(resolution.value),
    message: equal
      ? `${target} equals the expected value`
      : `${target} was ${JSON.stringify(summarise(resolution.value))}, expected ${JSON.stringify(expected)}`,
  };
}

function numericCompare(
  kind: 'numeric_lte' | 'numeric_gte',
  target: string,
  expected: unknown,
  observation: Observation,
): Outcome {
  const resolution = resolvePath(observation, target);
  const actual = resolution.value;
  if (typeof actual !== 'number' || !Number.isFinite(actual)) {
    return {
      status: 'ERROR',
      observed: summarise(actual),
      message: `${target} is not a finite number (${JSON.stringify(summarise(actual))})`,
    };
  }
  if (typeof expected !== 'number') {
    return {
      status: 'ERROR',
      observed: actual,
      message: `expected value for ${kind} must be a number`,
    };
  }
  const pass = kind === 'numeric_lte' ? actual <= expected : actual >= expected;
  const symbol = kind === 'numeric_lte' ? '<=' : '>=';
  return {
    status: pass ? 'PASS' : 'FAIL',
    observed: actual,
    message: `${target} = ${actual}, required ${symbol} ${expected}`,
  };
}

interface ChangeSpec {
  seed?: string | null;
  field?: string;
  from?: unknown;
  to?: unknown;
  compare?: 'quantity' | 'closed' | 'open' | 'unattributable';
  reason?: string;
}

/**
 * A record changed the way the demonstration changed it.
 *
 * The case is compared with where it started, not with a number written down
 * at compile time: `seed` resolves the same record in the starting world. From
 * the demonstration's start, the end must be the demonstration's end. From
 * anywhere else one demonstration may not say what the job does — "add 10" and
 * "set to 10" both went 0 → 10 — so a result that either reading explains is no
 * verdict, and only a result that no reading explains fails. A free-text value
 * that differs may be the system's own rendering, and is not judged either.
 */
function stateChange(target: string, expected: unknown, observation: Observation): Outcome {
  const spec = (expected ?? {}) as ChangeSpec;
  if (spec.compare === 'unattributable') {
    return {
      status: 'UNVERIFIABLE',
      observed: null,
      message: `not checked: ${spec.reason ?? 'nothing names one record, so its change cannot be attributed'}`,
    };
  }
  const field = spec.field;
  if (!field || spec.compare === undefined) {
    return { status: 'ERROR', observed: null, message: 'state_change needs a field and a comparison' };
  }

  const created = spec.seed === null || spec.seed === undefined;
  const now = recordsAt(observation, target);
  const start = created ? [] : recordsAt(observation, spec.seed as string);
  if (now.length > 1 || start.length > 1) {
    return {
      status: 'UNVERIFIABLE',
      observed: now.length,
      message: `more than one record answers to ${target}, so which one changed cannot be told`,
    };
  }
  const record = now[0];
  const started = start[0];
  if (!created && started === undefined) {
    return {
      status: 'UNVERIFIABLE',
      observed: record?.[field] ?? null,
      message: `the record the demonstration changed did not exist when this case started (${target})`,
    };
  }
  if (record === undefined) {
    return {
      status: 'FAIL',
      observed: null,
      message: created
        ? `the record the demonstration created is not there (${target})`
        : `the record the demonstration changed is gone (${target})`,
    };
  }

  const value = record[field];
  const demonstrated = changeWords(field, created ? undefined : spec.from, spec.to);
  const observed = changeWords(field, created ? undefined : started?.[field], value);
  if (created || sameValue(started?.[field], spec.from)) {
    if (sameValue(value, spec.to)) return { status: 'PASS', observed: value, message: `${demonstrated}, as demonstrated` };
    if (spec.compare === 'open') {
      return {
        status: 'UNVERIFIABLE',
        observed: value,
        message: `expected ${demonstrated}; observed ${observed}. Free text can be the system's own rendering, so a different value is not judged`,
      };
    }
    return { status: 'FAIL', observed: value, message: `expected ${demonstrated}; observed ${observed}` };
  }

  const from = spec.from;
  const to = spec.to;
  const begun = started?.[field];
  const elsewhere = `the case started at ${field} ${quoted(begun)}, not the demonstrated ${quoted(from)}`;
  if (spec.compare === 'quantity' && typeof begun === 'number' && typeof from === 'number' && typeof to === 'number') {
    const added = round6(begun + (to - from));
    const byAdding = typeof value === 'number' && sameValue(value, added);
    const bySetting = sameValue(value, to);
    if (byAdding && bySetting) return { status: 'PASS', observed: value, message: `${observed}, as demonstrated` };
    if (!byAdding && !bySetting) {
      return {
        status: 'FAIL',
        observed: value,
        message: `${elsewhere}: adding the demonstrated ${signed(to - from)} gives ${added} and setting it gives ${to}; observed ${observed}`,
      };
    }
    return {
      status: 'UNVERIFIABLE',
      observed: value,
      message: `${elsewhere}: ${quoted(value)} is what ${byAdding ? `adding ${signed(to - from)}` : `setting ${to}`} gives, and one demonstration cannot tell whether the job adds or sets`,
    };
  }
  if (sameValue(value, to)) return { status: 'PASS', observed: value, message: `${field} reached the demonstrated ${quoted(to)}` };
  return { status: 'UNVERIFIABLE', observed: value, message: `${elsewhere}, so what it should become is not known; observed ${observed}` };
}

function recordsAt(observation: Observation, path: string): Record<string, unknown>[] {
  const { found, value } = resolvePath(observation, path);
  if (!found || value === null || value === undefined) return [];
  return (Array.isArray(value) ? value : [value]).filter(
    (entry): entry is Record<string, unknown> => typeof entry === 'object' && entry !== null,
  );
}

/** Numbers compared after rounding, as the projection rounds; null and absent are one thing. */
function sameValue(a: unknown, b: unknown): boolean {
  if (typeof a === 'number' && typeof b === 'number') return round6(a) === round6(b);
  if ((a === null || a === undefined) && (b === null || b === undefined)) return true;
  return deepEqual(a, b);
}

/** `minutes 0 → 1 (+1)`, or `minutes 4` for a record that had no value before. */
function changeWords(field: string, from: unknown, to: unknown): string {
  if (from === undefined) return `${field} ${quoted(to)}`;
  const delta = typeof from === 'number' && typeof to === 'number' ? ` (${signed(to - from)})` : '';
  return `${field} ${quoted(from)} → ${quoted(to)}${delta}`;
}

function signed(value: number): string {
  const rounded = round6(value);
  return rounded >= 0 ? `+${rounded}` : String(rounded);
}

function quoted(value: unknown): string {
  return value === undefined ? 'nothing' : JSON.stringify(value);
}

function round6(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

function containment(
  kind: 'contains' | 'not_contains',
  target: string,
  expected: unknown,
  observation: Observation,
): Outcome {
  const resolution = resolvePath(observation, target);
  const value = resolution.value;
  let contains = false;
  if (typeof value === 'string' && typeof expected === 'string') {
    contains = value.includes(expected);
  } else if (Array.isArray(value)) {
    contains = value.some((entry) => deepEqual(entry, expected));
  } else if (value !== null && value !== undefined) {
    contains = JSON.stringify(value).includes(String(expected));
  }
  const want = kind === 'contains';
  return {
    status: contains === want ? 'PASS' : 'FAIL',
    observed: summarise(value),
    message: `${target} ${contains ? 'contains' : 'does not contain'} ${JSON.stringify(expected)}`,
  };
}

function urlMatches(expected: unknown, observation: Observation): Outcome {
  const url = observation.url ?? '';
  if (typeof expected !== 'string') {
    return { status: 'ERROR', observed: url, message: 'url_matches requires a string pattern' };
  }
  let matched: boolean;
  try {
    matched = new RegExp(expected).test(url);
  } catch (error) {
    return {
      status: 'ERROR',
      observed: url,
      message: `invalid pattern: ${(error as Error).message}`,
    };
  }
  return {
    status: matched ? 'PASS' : 'FAIL',
    observed: url,
    message: `url ${matched ? 'matches' : 'does not match'} /${expected}/`,
  };
}

function elementPresence(
  kind: 'element_exists' | 'element_not_exists',
  target: string,
  observation: Observation,
): Outcome {
  const selectors = observation.dom?.selectors ?? [];
  const present = selectors.includes(target);
  const want = kind === 'element_exists';
  return {
    status: present === want ? 'PASS' : 'FAIL',
    observed: present,
    message: `selector ${target} ${present ? 'present' : 'absent'} in the observed page`,
  };
}

function httpStatus(expected: unknown, observation: Observation): Outcome {
  const status = observation.http?.status;
  if (status === undefined) {
    return { status: 'ERROR', observed: null, message: 'no HTTP status was observed' };
  }
  return {
    status: status === expected ? 'PASS' : 'FAIL',
    observed: status,
    message: `HTTP status was ${status}, expected ${String(expected)}`,
  };
}

function eventPresence(
  kind: 'event_occurred' | 'event_not_occurred',
  target: string,
  expected: unknown,
  observation: Observation,
): Outcome {
  const matching = observation.events.filter(
    (event) => event.type === target && payloadMatches(event, expected),
  );
  const occurred = matching.length > 0;
  const want = kind === 'event_occurred';
  return {
    status: occurred === want ? 'PASS' : 'FAIL',
    observed: { count: matching.length, first: matching[0] ? summarise(matching[0]) : null },
    message: `event '${target}' occurred ${matching.length} time(s)`,
  };
}

/** An `expected` object acts as a partial match over the event payload. */
function payloadMatches(event: ObservedEvent, expected: unknown): boolean {
  if (expected === undefined || expected === null) return true;
  if (typeof expected !== 'object' || Array.isArray(expected)) return true;
  return Object.entries(expected as Record<string, unknown>).every(([key, value]) =>
    deepEqual(event.payload[key], value),
  );
}

export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || a === undefined || b === undefined) return false;
  if (typeof a !== typeof b) return false;
  if (typeof a !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((entry, i) => deepEqual(entry, b[i]));
  }
  const aKeys = Object.keys(a as object).sort();
  const bKeys = Object.keys(b as object).sort();
  if (aKeys.length !== bKeys.length || aKeys.some((k, i) => k !== bKeys[i])) return false;
  return aKeys.every((key) =>
    deepEqual((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]),
  );
}

/** Keeps evidence payloads small enough to store and render. */
function summarise(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.length > 5 ? [...value.slice(0, 5), `…${value.length - 5} more`] : value;
  }
  return value;
}
