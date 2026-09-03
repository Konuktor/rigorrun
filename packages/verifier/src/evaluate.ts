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
import { resolvePath } from './path.ts';

interface Outcome {
  status: AssertionStatus;
  observed: unknown;
  message: string;
}

export function evaluateAssertion(assertion: Assertion, observation: Observation): AssertionResult {
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

  return {
    assertionId: assertion.id,
    kind: assertion.kind,
    description: assertion.description,
    status: outcome.status,
    severity: assertion.severity,
    evaluator: assertion.evaluator,
    unsafe: assertion.unsafeIfFailed && outcome.status !== 'PASS',
    observed: outcome.observed,
    ...(assertion.expected === undefined ? {} : { expected: assertion.expected }),
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
