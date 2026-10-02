/**
 * Binding a case to the records that were made for it.
 *
 * A case written for an environment that materializes its world cannot name
 * the records it is about: they do not exist until the case starts, and every
 * attempt gets new ones. So the case names them by role instead — a token
 * `{{bind:name}}` in its text and in its checks — and the runner replaces each
 * token with the identifier the environment reported, before the agent sees
 * the task or the verifier sees a check.
 *
 * Two rules make that safe, and both fail loudly rather than degrade:
 *
 *  1. Every token must be bound. A token left in place would reach the agent
 *     as text and the verifier as a path that matches nothing, and a path that
 *     matches nothing makes a `state_not_exists` check pass forever.
 *
 *  2. A value substituted into a check path must be a plain identifier. The
 *     path language gives meaning to `]`, `&`, `=` and `.`, so a value carrying
 *     any of them would change what the check asks rather than which record it
 *     asks about. Text the agent reads may carry anything — an address, a
 *     sentence — because text is never parsed.
 *
 * The seed is never bound: it is what the bindings come from.
 */
import type { BenchmarkCase } from './benchmark.ts';

/** Binding name to the identifier the named record was given. */
export type CaseBindings = Readonly<Record<string, string>>;

/**
 * The environment variable an after-case program finds the case's bindings in,
 * as a JSON object, so it can look at the very records the case was about.
 */
export const CASE_BINDINGS_ENV = 'RIGORRUN_CASE_BINDINGS';

const TOKEN = /\{\{bind:([^{}]*)\}\}/g;
const TOKEN_START = '{{bind:';
/** What a binding name is, and what a value must be to go inside a check path. */
const PLAIN = /^[A-Za-z0-9_]+$/;

/** A case could not be bound. The case cannot run; it is not the agent's fault. */
export class BindingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BindingError';
  }
}

/**
 * The case with every token replaced, as a new object; the input is untouched.
 *
 * Bound: the task's instruction and inputs; every check's `target`,
 * `expected`, `applicableWhen` and `orElse`; and the reference plan. A token
 * anywhere else in the case is an authoring mistake and is refused, so nothing
 * unbound can reach an agent. A token always becomes a string.
 */
export function bindCase(testCase: BenchmarkCase, bindings: CaseBindings): BenchmarkCase {
  for (const [name, value] of Object.entries(bindings)) {
    if (!PLAIN.test(name)) {
      throw new BindingError(
        `"${name}" is not a binding name: use letters, digits and underscores.`,
      );
    }
    if (value.includes(TOKEN_START)) {
      throw new BindingError(`The value bound to "${name}" contains a binding token itself.`);
    }
  }
  const binder = new Binder(testCase.id, bindings);

  const bound: BenchmarkCase = {
    ...testCase,
    task: {
      ...testCase.task,
      instruction: binder.text(testCase.task.instruction, 'task.instruction'),
      inputs: binder.value(testCase.task.inputs, 'task.inputs') as Record<string, unknown>,
      ...(testCase.task.principal
        ? {
            principal: binder.value(
              testCase.task.principal,
              'task.principal',
            ) as typeof testCase.task.principal,
          }
        : {}),
    },
    checks: testCase.checks.map((check, index) => {
      const where = `checks[${index}]`;
      return {
        ...check,
        target: binder.path(check.target, `${where}.target`),
        ...('expected' in check
          ? { expected: binder.expected(check.kind, check.expected, `${where}.expected`) }
          : {}),
        ...(check.applicableWhen
          ? { applicableWhen: binder.condition(check.applicableWhen, `${where}.applicableWhen`) }
          : {}),
        ...(check.orElse ? { orElse: binder.condition(check.orElse, `${where}.orElse`) } : {}),
      };
    }),
    referencePlan: testCase.referencePlan.map(
      (step, index) => binder.value(step, `referencePlan[${index}]`) as typeof step,
    ),
  };

  const { seed: _seed, ...visible } = bound;
  const stray = tokenIn(visible, '');
  if (stray !== undefined) {
    throw new BindingError(
      `Case ${testCase.id} has a binding token at ${stray} that cannot be bound there, or that ` +
        'is not written as {{bind:name}}.',
    );
  }
  return bound;
}

class Binder {
  constructor(
    private readonly caseId: string,
    private readonly bindings: CaseBindings,
  ) {}

  /** Free text: any value may go in. */
  text(source: string, where: string): string {
    return source.replace(TOKEN, (_token, name: string) => this.lookup(name, where));
  }

  /** A check path: only a plain identifier may go in. */
  path(source: string, where: string): string {
    return source.replace(TOKEN, (_token, name: string) => {
      const value = this.lookup(name, where);
      if (!PLAIN.test(value)) {
        throw new BindingError(
          `Case ${this.caseId}, ${where}: the value bound to "${name}" is not a plain identifier, ` +
            'so it cannot be part of a check path.',
        );
      }
      return value;
    });
  }

  /** Strings anywhere inside, bound as text. Keys are left as written. */
  value(source: unknown, where: string): unknown {
    if (typeof source === 'string') return this.text(source, where);
    if (Array.isArray(source))
      return source.map((item, index) => this.value(item, `${where}[${index}]`));
    if (source !== null && typeof source === 'object') {
      // `fromEntries` defines own properties, so a key of "__proto__" in an
      // authored case stays an ordinary key instead of becoming a prototype.
      return Object.fromEntries(
        Object.entries(source).map(([key, item]) => [key, this.value(item, `${where}.${key}`)]),
      );
    }
    return source;
  }

  /**
   * An expectation is a value, except where a kind reads part of it as a path:
   * a `state_change` names the record's starting position by `seed`, and the
   * field it compares by `field`.
   */
  expected(kind: string, source: unknown, where: string): unknown {
    if (
      kind !== 'state_change' ||
      source === null ||
      typeof source !== 'object' ||
      Array.isArray(source)
    ) {
      return this.value(source, where);
    }
    return Object.fromEntries(
      Object.entries(source).map(([key, item]) => [
        key,
        (key === 'seed' || key === 'field') && typeof item === 'string'
          ? this.path(item, `${where}.${key}`)
          : this.value(item, `${where}.${key}`),
      ]),
    );
  }

  condition<T extends { kind: string; target: string; expected?: unknown }>(
    source: T,
    where: string,
  ): T {
    return {
      ...source,
      target: this.path(source.target, `${where}.target`),
      ...('expected' in source
        ? { expected: this.expected(source.kind, source.expected, `${where}.expected`) }
        : {}),
    };
  }

  private lookup(name: string, where: string): string {
    const value = Object.hasOwn(this.bindings, name) ? this.bindings[name] : undefined;
    if (value === undefined) {
      const known = Object.keys(this.bindings).sort().join(', ') || 'none';
      throw new BindingError(
        `Case ${this.caseId}, ${where}: nothing is bound to "${name}". Bound: ${known}.`,
      );
    }
    return value;
  }
}

/** Where the first string holding a token is, or `undefined` when none does. */
function tokenIn(value: unknown, where: string): string | undefined {
  if (typeof value === 'string') return value.includes(TOKEN_START) ? where || '(root)' : undefined;
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      const found = tokenIn(item, `${where}[${index}]`);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  if (value !== null && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      const at = where ? `${where}.${key}` : key;
      if (key.includes(TOKEN_START)) return at;
      const found = tokenIn(item, at);
      if (found !== undefined) return found;
    }
  }
  return undefined;
}
