/**
 * The EnvironmentAdapter boundary.
 *
 * Everything RigorRun can do to a business system, and everything it can learn
 * about one, goes through this interface. Point it at a staging system and the
 * rest of the product works unchanged; that is the whole claim.
 *
 * Note what is deliberately *absent*: there is no `getObservation()`. An
 * adapter reports raw state and raw events. RigorRun computes the projection
 * assertions are written against. If adapters could return an observation they
 * would hand-write the domain joins again — which is exactly how the previous
 * version of this product ended up with a "generic" verifier that only worked
 * on refunds. Making that impossible is more reliable than discouraging it.
 */
import type {
  ActionDefinition,
  CaseConfig,
  CaseConfigVariable,
  EnvironmentSchema,
} from './schema.ts';
import type { CanonicalState, EnvEvent, StateSnapshot } from './state.ts';

export type MaybePromise<T> = T | Promise<T>;

export interface ActionResult {
  ok: boolean;
  data?: unknown;
  error?: { code: string; message: string };
}

/**
 * How the schema-driven demo app should present this environment. Read only by
 * the UI; the compiler never sees it.
 */
export interface PresentationHints {
  label: string;
  tagline: string;
  /** Hex accent colour. */
  accent: string;
  /** One or two characters for the app mark. */
  mark: string;
  /** Entity names to show in the primary navigation, in order. */
  navEntities: readonly string[];
  /** Entity whose detail page carries the workflow's main action. */
  focusEntity: string;
}

export interface EnvironmentAdapter {
  readonly id: string;
  readonly name: string;
  readonly description: string;

  describeEntities(): EnvironmentSchema;
  getActions(): ActionDefinition[];
  describeCaseConfig(): CaseConfigVariable[];
  describePresentation(): PresentationHints;

  reset(): MaybePromise<void>;
  seed(state: CanonicalState, config?: CaseConfig): MaybePromise<void>;

  getState(): MaybePromise<CanonicalState>;
  getEvents(): MaybePromise<EnvEvent[]>;

  executeAction(name: string, args: Record<string, unknown>): MaybePromise<ActionResult>;

  snapshot(): MaybePromise<StateSnapshot>;
  restore(snapshot: StateSnapshot): MaybePromise<void>;
}

/**
 * A named starting world plus the request the operator was handed.
 *
 * Fixtures are the only place a workflow's actual data lives. The compiler and
 * the generator read the schema and the demonstration; they never read this.
 */
export interface EnvironmentFixture {
  id: string;
  title: string;
  summary: string;
  state: CanonicalState;
  config: CaseConfig;
  /** Arguments the operator was given, keyed by the primary action's params. */
  request: Record<string, unknown>;
}

export function actionByName(
  adapter: EnvironmentAdapter,
  name: string,
): ActionDefinition | undefined {
  return adapter.getActions().find((action) => action.name === name);
}

/** Mutating actions, in a stable order. */
export function mutatingActions(adapter: EnvironmentAdapter): ActionDefinition[] {
  return adapter
    .getActions()
    .filter((action) => !action.readOnly)
    .sort((a, b) => a.name.localeCompare(b.name));
}
