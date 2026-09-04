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
 * How a record's lifecycle value should read to a person.
 *
 * Declared rather than inferred: nothing generic can know that "cleared" is
 * good news and "refused" is not, and a renderer that guessed from the word
 * would be a renderer with a vocabulary in it.
 */
export type StatusTone = 'positive' | 'progress' | 'warning' | 'danger' | 'neutral';

/** How a collection of records is best looked at. */
export type ViewKind = 'table' | 'board' | 'list';

export interface ColumnHint {
  /** A field of the entity, or a `relation__field` path one hop out. */
  field: string;
  label?: string;
  width?: 'narrow' | 'normal' | 'wide';
  align?: 'start' | 'end';
  /** The column a person scans down to find the row they want. */
  emphasis?: boolean;
}

export interface DetailSection {
  title: string;
  fields: readonly string[];
  /** `facts` renders label/value pairs; `prose` renders long text. */
  kind?: 'facts' | 'prose';
}

/**
 * Everything the renderer needs to present one kind of record.
 *
 * All of it is data. The renderer reads these declarations and has no idea
 * whether it is drawing an invoice queue or a warehouse.
 */
export interface EntityPresentation {
  entity: string;
  /** What a collection of them is called, e.g. "Invoices". */
  plural: string;
  view: ViewKind;
  columns: readonly ColumnHint[];
  /** Status field to group a board by. Ignored for other views. */
  groupBy?: string;
  sections: readonly DetailSection[];
  /** Actions offered from a record's page, in the order they belong. */
  actions?: readonly string[];
  /** Field shown under the title on a record's page. */
  subtitleField?: string;
}

/**
 * How the schema-driven demo app should present this environment.
 *
 * Read only by the renderer; the compiler never sees any of it. It exists so
 * that four genuinely different-looking pieces of business software can be one
 * implementation — the differences are declarations, not branches.
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
  /** What this software calls each of them in its nav. */
  navLabels?: Readonly<Record<string, string>>;
  /** Short button text per action. An action's description is a sentence,
   * which is right for an agent's tool catalogue and wrong on a button. */
  actionLabels?: Readonly<Record<string, string>>;
  /** Entity whose detail page carries the workflow's main action. */
  focusEntity: string;
  layout?: 'sidebar' | 'topbar';
  density?: 'comfortable' | 'compact';
  /** What each lifecycle value means, so colour is declared not guessed. */
  statusTones?: Readonly<Record<string, StatusTone>>;
  entities?: readonly EntityPresentation[];
}

/** The presentation for one entity, or a reasonable default from the schema. */
export function presentationFor(
  hints: PresentationHints,
  entity: string,
): EntityPresentation | undefined {
  return hints.entities?.find((candidate) => candidate.entity === entity);
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
