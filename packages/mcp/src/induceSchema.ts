/**
 * Working out what records a system has, from what its tools hand back.
 *
 * MCP gives you operations. RigorRun needs records, fields, roles and links —
 * because `role` is what makes a threshold rule, a boundary case or a
 * separation-of-duties check possible at all. Nothing bridges that gap
 * automatically, and the obvious bridge is the forbidden one: look at the field
 * names. A field called `amount` is money, one called `status` is a lifecycle,
 * one called `approvedBy` is a person. That works, and it would put a business
 * vocabulary back inside the generic pipeline, which is the exact mistake this
 * codebase was already dragged out of once.
 *
 * So this reads structure and nothing else. Uniqueness. Cardinality. Whether a
 * value ever changes. Whether one record's value appears in another record's
 * identifier. How many decimal places a number carries. From that it proposes a
 * schema — and then it *asks*, because a structural signal can tell you a field
 * holds a small closed set of values but never that the set means a lifecycle,
 * and it can tell you a number is a magnitude but never whether it is pounds or
 * kilograms.
 *
 * Which is the honest shape for this anyway. RigorRun already separates what it
 * observed from what it inferred from what a person confirmed, and refuses to
 * enforce a guess. An induced schema is a draft with its evidence attached, and
 * confirming it is part of reviewing what RigorRun learned rather than a
 * separate act of configuration.
 */
import type {
  EntitySchema,
  EnvironmentSchema,
  FieldRole,
  FieldSchema,
  FieldType,
  RelationshipSchema,
  Unit,
} from '@rigorrun/environment';
import { canonicalisePayload } from '@rigorrun/connector';

/** One thing a tool gave back, and which tool gave it. */
export interface PayloadObservation {
  tool: string;
  /**
   * The data a result carried: `structuredContent`, or a JSON body, or JSON
   * that arrived inside a text block — as `normalizeCallResult` reads it.
   * Never a raw content-block array: `{type:'text', text:'…'}` has two scalar
   * fields and would be taken for a record.
   */
  payload: unknown;
  /**
   * Which nominated read this answer came from, and whether it was read before
   * or after the job. Two readings of one read are what show a field changing
   * for the same record — the evidence that it describes the record rather than
   * names it. Absent for anything else, such as a tool's own result.
   */
  reading?: { read: string; moment: 'before' | 'after' };
}

export type QuestionKind =
  | 'entity_name'
  | 'id_field'
  | 'field_role'
  | 'unit'
  | 'untrusted'
  | 'relationship';

/**
 * Something RigorRun could not settle by looking, phrased for a person.
 *
 * Every one of these carries the observation that prompted it. "Is this money?"
 * is a much easier question when it arrives as "every value seen had exactly
 * two decimal places — 900, 250, 500 — is this a quantity, and in what unit?"
 */
export interface SchemaQuestion {
  id: string;
  kind: QuestionKind;
  entity: string;
  field?: string;
  /** The question itself. */
  text: string;
  /** What was actually seen. Never a conclusion. */
  evidence: string;
  /** RigorRun's current guess, already applied to the draft. */
  proposed: string;
  /** What a person may choose instead. */
  options: readonly string[];
  confidence: 'strong' | 'moderate' | 'weak';
}

export interface InducedSchema {
  schema: EnvironmentSchema;
  questions: SchemaQuestion[];
  /** Records seen but too thin to be worth proposing, with a count each. */
  ignored: { signature: string; seen: number }[];
}

// ------------------------------------------------------------------ gathering

/**
 * Everything seen of one record shape.
 *
 * Rows are kept whole rather than reduced to per-field tallies on the way in,
 * because the useful questions turn out to be about *records* rather than about
 * values. "How many distinct values did this field hold" cannot tell a
 * lifecycle from a note: observe one booking five times and its note looks
 * every bit as repeated as its status. "How many distinct values did this field
 * hold across distinct records" separates them immediately — and that needs an
 * identifier, which needs the rows.
 */
interface EntityEvidence {
  /** Sorted field names — the identity of a record shape. */
  signature: string;
  /** Names the server used for this shape, most frequent first. */
  containerNames: Map<string, number>;
  fieldOrder: string[];
  rows: Record<string, unknown>[];
  /**
   * Row indices grouped by the collection they arrived in.
   *
   * Uniqueness *within one returned list* is the signal for an identifier. A
   * field that repeats across two separate reads has merely been read twice.
   */
  collections: number[][];
  /** For each collection, the answer it came from: its index among the observations. */
  collectionSources: number[];
  /**
   * For each collection, where it sat: a list, a record standing on its own, or
   * anything inside a list entry. Only the first two are readings of the same
   * records from one answer to the next. A list entry is also walked on its
   * own, and pairing those by position would pair different records whenever
   * a list gains a row at its front.
   */
  collectionKinds: CollectionKind[];
}

type CollectionKind = 'list' | 'single' | 'entry';

/** Where a walk is: which answer, and the running tally of parts and totals. */
interface Walk {
  source: number;
  totals: Map<string, TotalTally>;
}

/** Whether a numeric field of a list's records added up to a field of the record holding the list. */
interface TotalTally {
  child: string;
  part: string;
  parent: string;
  whole: string;
  held: number;
  broken: number;
}

/** What names a record: one field, several together, or — honestly — nothing observed. */
type Identity =
  | { unestablished: false; idField: string; keyFields?: string[] }
  | { unestablished: true; idField: string };

const MIN_FIELDS_FOR_RECORD = 2;
const MAX_KEY_FIELDS = 3;
const MAX_WALK_DEPTH = 6;
const MAX_ENUM_VALUES = 12;
const MAX_ENUM_VALUE_LENGTH = 64;

function isRecordLike(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const scalars = Object.values(value).filter(
    (entry) => entry === null || typeof entry !== 'object',
  );
  return scalars.length >= MIN_FIELDS_FOR_RECORD;
}

function signatureOf(row: Record<string, unknown>): string {
  return Object.keys(row).sort().join('|');
}

function evidenceFor(
  row: Record<string, unknown>,
  containerName: string,
  into: Map<string, EntityEvidence>,
): EntityEvidence {
  const signature = signatureOf(row);
  let evidence = into.get(signature);
  if (!evidence) {
    evidence = {
      signature,
      containerNames: new Map(),
      fieldOrder: Object.keys(row),
      rows: [],
      collections: [],
      collectionSources: [],
      collectionKinds: [],
    };
    into.set(signature, evidence);
  }
  if (containerName) {
    evidence.containerNames.set(
      containerName,
      (evidence.containerNames.get(containerName) ?? 0) + 1,
    );
  }
  return evidence;
}

/** Walks a payload and collects every record-shaped object it contains. */
function collect(
  payload: unknown,
  containerName: string,
  depth: number,
  into: Map<string, EntityEvidence>,
  walk: Walk,
  inList = false,
): void {
  if (depth > MAX_WALK_DEPTH) return;

  if (Array.isArray(payload)) {
    // One returned list is one collection, and that grouping is what makes
    // uniqueness mean something.
    const group = new Map<EntityEvidence, number[]>();
    for (const entry of payload) {
      if (isRecordLike(entry)) {
        const evidence = evidenceFor(entry, containerName, into);
        evidence.rows.push(entry);
        const indices = group.get(evidence) ?? [];
        indices.push(evidence.rows.length - 1);
        group.set(evidence, indices);
      }
      if (typeof entry === 'object' && entry !== null) {
        collect(entry, containerName, depth + 1, into, walk, true);
      }
    }
    for (const [evidence, indices] of group) {
      addCollection(evidence, indices, walk.source, inList ? 'entry' : 'list');
    }
    return;
  }

  if (typeof payload !== 'object' || payload === null) return;
  const object = payload as Record<string, unknown>;

  if (isRecordLike(object)) {
    const evidence = evidenceFor(object, containerName, into);
    evidence.rows.push(object);
    addCollection(evidence, [evidence.rows.length - 1], walk.source, inList ? 'entry' : 'single');
    noteTotals(object, walk.totals);
  }
  // Keep walking regardless: a wrapper like `{ bookings: [...] }` is not itself
  // a record, and a record may carry a nested collection.
  for (const [key, value] of Object.entries(object)) {
    if (typeof value === 'object' && value !== null) {
      collect(value, key, depth + 1, into, walk, inList);
    }
  }
}

function addCollection(
  evidence: EntityEvidence,
  indices: number[],
  source: number,
  kind: CollectionKind,
): void {
  evidence.collections.push(indices);
  evidence.collectionSources.push(source);
  evidence.collectionKinds.push(kind);
}

/**
 * Whether a list's numeric fields add up to a field of the record holding it.
 *
 * A report's groups add up to its total; an order's lines add up to its sum. A
 * part of a total is a quantity, however unique its values happen to be, and
 * it is never what names a record: a group that gains a minute is the same
 * group. Tallied over every answer, so an answer where the sum does not hold
 * outweighs any number of coincidences.
 */
function noteTotals(record: Record<string, unknown>, totals: Map<string, TotalTally>): void {
  const wholes = Object.entries(record).filter(
    (entry): entry is [string, number] => typeof entry[1] === 'number' && entry[1] !== 0,
  );
  if (wholes.length === 0) return;
  const parent = signatureOf(record);
  for (const value of Object.values(record)) {
    if (!Array.isArray(value) || value.length < 2 || !value.every(isRecordLike)) continue;
    const children = value as Record<string, unknown>[];
    const child = signatureOf(children[0]!);
    if (!children.every((entry) => signatureOf(entry) === child)) continue;
    for (const part of Object.keys(children[0]!)) {
      if (!children.every((entry) => typeof entry[part] === 'number')) continue;
      const sum = round6(children.reduce((total, entry) => total + (entry[part] as number), 0));
      for (const [whole, amount] of wholes) {
        const key = [child, part, parent, whole].join('\u0000');
        const tally = totals.get(key) ?? { child, part, parent, whole, held: 0, broken: 0 };
        if (sum === round6(amount)) tally.held += 1;
        else tally.broken += 1;
        totals.set(key, tally);
      }
    }
  }
}

/** For each record shape, its fields that are parts of a total, as `Entity.field` of the total. */
function resolveTotals(
  totals: Map<string, TotalTally>,
  evidence: readonly EntityEvidence[],
  names: readonly string[],
): Map<string, Map<string, string>> {
  const nameOf = new Map(evidence.map((entry, index) => [entry.signature, names[index]!]));
  const parts = new Map<string, Map<string, string>>();
  for (const tally of totals.values()) {
    if (tally.held === 0 || tally.broken > 0) continue;
    const parent = nameOf.get(tally.parent);
    if (parent === undefined || !nameOf.has(tally.child)) continue;
    const ofChild = parts.get(tally.child) ?? new Map<string, string>();
    if (!ofChild.has(tally.part)) ofChild.set(tally.part, `${parent}.${tally.whole}`);
    parts.set(tally.child, ofChild);
  }
  return parts;
}

function round6(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

// ------------------------------------------------------------------ inference

const ISO_8601 =
  /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;

/** Non-null values of one field, in the order they were seen. */
function valuesOf(evidence: EntityEvidence, field: string): unknown[] {
  return evidence.rows.map((row) => row[field]).filter((value) => value !== null && value !== undefined);
}

function distinctOf(evidence: EntityEvidence, field: string): Set<string> {
  return new Set(valuesOf(evidence, field).map((value) => String(value)));
}

function nullsOf(evidence: EntityEvidence, field: string): number {
  return evidence.rows.filter((row) => row[field] === null || row[field] === undefined).length;
}

/**
 * The field that names a record.
 *
 * Unique *within each returned list*, never null, and never seen changing. The
 * per-list qualifier is the whole trick: reading the same booking five times
 * makes its identifier look highly repetitive if you only count values, and
 * perfectly unique if you count within each answer the server gave.
 *
 * "Never seen changing" is checked, through `unstable`: the fields the
 * recording's two readings showed changing for the same record, and the parts
 * of a total. Counting distinct values alone rewards exactly those — a group's
 * minutes that went from 0 to 1 hold one more distinct value than its label.
 */
function chooseIdField(evidence: EntityEvidence, unstable: ReadonlySet<string>): string | undefined {
  const candidates = evidence.fieldOrder.filter((name) => {
    if (unstable.has(name)) return false;
    if (nullsOf(evidence, name) > 0) return false;
    const values = valuesOf(evidence, name);
    if (values.length === 0) return false;
    if (!values.every((value) => typeof value === 'string' || typeof value === 'number')) {
      return false;
    }
    return evidence.collections.every((indices) => {
      const seen = indices.map((index) => String(evidence.rows[index]?.[name]));
      return new Set(seen).size === seen.length;
    });
  });

  // Where several fields qualify, prefer the one that distinguishes the most
  // records. Among ties, a field whose values look like identifiers — whole
  // numbers, or strings without whitespace — beats one whose values look like
  // measurements or sentences: three rows with three different amounts and
  // three different titles are still identified by their number, not by their
  // price. Structural, and still a question rather than a decision.
  return candidates.sort(
    (a, b) =>
      distinctOf(evidence, b).size - distinctOf(evidence, a).size ||
      identifierLikeness(evidence, b) - identifierLikeness(evidence, a),
  )[0];
}

/** 1 when every value is a whole number or a whitespace-free string, else 0. */
function identifierLikeness(evidence: EntityEvidence, field: string): number {
  return valuesOf(evidence, field).every(
    (value) =>
      (typeof value === 'number' && Number.isInteger(value)) ||
      (typeof value === 'string' && !/\s/.test(value)),
  )
    ? 1
    : 0;
}

/**
 * What names a record, in the order it is decided: one stable field, else the
 * smallest set of stable fields that together tell every record apart, else
 * nothing — never a guess, and never the first field by default, which used to
 * merge every record that shared its value.
 */
function chooseIdentity(evidence: EntityEvidence, unstable: ReadonlySet<string>): Identity {
  const single = chooseIdField(evidence, unstable);
  if (single !== undefined) return { unestablished: false, idField: single };
  const together = chooseKeyFields(evidence, unstable);
  if (together !== undefined) return { unestablished: false, idField: together[0]!, keyFields: together };
  return { unestablished: true, idField: evidence.fieldOrder[0] ?? 'id' };
}

/**
 * The smallest set of stable fields that tells every record apart, when no
 * single field does: a report row named by its dimensions together. Null is a
 * value of a dimension — the row for "no project" is still a row.
 */
function chooseKeyFields(evidence: EntityEvidence, unstable: ReadonlySet<string>): string[] | undefined {
  const stable = evidence.fieldOrder.filter(
    (name) =>
      !unstable.has(name) &&
      evidence.rows.every((row) => isScalar(row[name])) &&
      evidence.rows.some((row) => row[name] !== null && row[name] !== undefined),
  );
  for (let size = 1; size <= Math.min(MAX_KEY_FIELDS, stable.length); size += 1) {
    for (const candidate of combinations(stable, size)) {
      const tellsApart = evidence.collections.every((indices) => {
        const seen = indices.map((index) =>
          JSON.stringify(candidate.map((field) => evidence.rows[index]?.[field] ?? null)),
        );
        return new Set(seen).size === seen.length;
      });
      if (tellsApart) return candidate;
    }
  }
  return undefined;
}

function combinations<T>(items: readonly T[], size: number, from = 0): T[][] {
  if (size === 0) return [[]];
  const out: T[][] = [];
  for (let index = from; index <= items.length - size; index += 1) {
    for (const rest of combinations(items, size - 1, index + 1)) out.push([items[index]!, ...rest]);
  }
  return out;
}

function isScalar(value: unknown): boolean {
  return value === null || value === undefined || typeof value !== 'object';
}

/** Answers that are two readings of one nominated read, as [before, after]. */
function readingPairs(observations: readonly PayloadObservation[]): [number, number][] {
  const before = new Map<string, number>();
  observations.forEach((observation, index) => {
    if (observation.reading?.moment === 'before') before.set(observation.reading.read, index);
  });
  const pairs: [number, number][] = [];
  observations.forEach((observation, index) => {
    if (observation.reading?.moment !== 'after') return;
    const earlier = before.get(observation.reading.read);
    if (earlier !== undefined) pairs.push([earlier, index]);
  });
  return pairs;
}

/**
 * Fields seen changing for the same record between two readings of one read.
 *
 * No identifier is needed to see it, which is the point: the identifier is what
 * is being decided. Rows read identically both times are unchanged records and
 * are set aside. What is left on each side is paired only where two rows agree
 * on at least half their fields and each is the other's single best match; the
 * fields that differ within a pair changed. Rows that differ in most fields are
 * not paired, because from one recording a record that mostly changed and a
 * record replaced by another look the same.
 */
function changedFields(
  evidence: EntityEvidence,
  pairs: readonly [number, number][],
): { changed: Set<string>; compared: boolean } {
  const changed = new Set<string>();
  let compared = false;
  const fields = evidence.fieldOrder.filter((name) => evidence.rows.every((row) => isScalar(row[name])));
  if (fields.length === 0 || pairs.length === 0) return { changed, compared };

  const readings = new Map<string, Record<string, unknown>[][]>();
  evidence.collections.forEach((indices, index) => {
    const kind = evidence.collectionKinds[index];
    if (kind === undefined || kind === 'entry') return;
    const key = `${evidence.collectionSources[index]}:${kind}`;
    readings.set(key, [...(readings.get(key) ?? []), indices.map((row) => evidence.rows[row]!)]);
  });
  const agreement = (a: Record<string, unknown>, b: Record<string, unknown>): number =>
    fields.filter((field) => (a[field] ?? null) === (b[field] ?? null)).length;

  for (const [before, after] of pairs) {
    for (const kind of ['list', 'single'] as const) {
      const earlier = readings.get(`${before}:${kind}`) ?? [];
      const later = readings.get(`${after}:${kind}`) ?? [];
      for (let position = 0; position < Math.min(earlier.length, later.length); position += 1) {
        compared = true;
        const remaining = [...later[position]!];
        const left: Record<string, unknown>[] = [];
        for (const row of earlier[position]!) {
          const same = remaining.findIndex((other) => agreement(row, other) === fields.length);
          if (same >= 0) remaining.splice(same, 1);
          else left.push(row);
        }
        for (const row of left) {
          const partner = uniqueBest(row, remaining, agreement);
          if (partner === undefined || uniqueBest(partner, left, agreement) !== row) continue;
          if (agreement(row, partner) * 2 < fields.length) continue;
          for (const field of fields) {
            if ((row[field] ?? null) !== (partner[field] ?? null)) changed.add(field);
          }
        }
      }
    }
  }
  return { changed, compared };
}

/** The candidate that scores highest against `row`, or nothing when two tie. */
function uniqueBest<T>(row: T, candidates: readonly T[], score: (a: T, b: T) => number): T | undefined {
  let best: T | undefined;
  let bestScore = -1;
  let tied = false;
  for (const candidate of candidates) {
    const value = score(row, candidate);
    if (value > bestScore) {
      best = candidate;
      bestScore = value;
      tied = false;
    } else if (value === bestScore) {
      tied = true;
    }
  }
  return tied ? undefined : best;
}

/** The question about what names a record, with what was actually seen. */
function identityQuestion(
  name: string,
  evidence: EntityEvidence,
  identity: Identity,
  seen: { changed: readonly string[]; parts: readonly string[]; compared: boolean; recordCount: number },
): SchemaQuestion {
  const changing =
    seen.changed.length > 0
      ? ` Between the readings before and after the job, ${quoteList(seen.changed)} changed for the same ` +
        `${name}, so ${seen.changed.length === 1 ? 'it describes' : 'they describe'} ${article(name)} ${name} ` +
        'rather than name one.'
      : '';
  const summing =
    seen.parts.length > 0
      ? ` ${quoteList(seen.parts)} ${seen.parts.length === 1 ? 'adds' : 'add'} up to a total, so ` +
        `${seen.parts.length === 1 ? 'it is a quantity' : 'they are quantities'}, not a name.`
      : '';
  const base = { id: `q_id_${name}`, kind: 'id_field' as const, entity: name, options: evidence.fieldOrder };
  if (identity.unestablished) {
    return {
      ...base,
      text: `Which field identifies one ${name}?`,
      evidence:
        `No field, and no set of up to ${MAX_KEY_FIELDS} fields that stayed the same, was different for every ` +
        `${name} in each list the server returned.${changing}${summing} Until one is named, RigorRun keeps ` +
        `every ${name} it sees but cannot tell a changed one from a replaced one.`,
      proposed: '',
      confidence: 'weak',
    };
  }
  if (identity.keyFields !== undefined) {
    return {
      ...base,
      text: `Do ${quoteList(identity.keyFields)} together identify one ${name}?`,
      evidence:
        `No single field that stayed the same was different for every ${name}; together these were, ` +
        `in each list the server returned.${changing}${summing}`,
      proposed: identity.keyFields.join(' + '),
      confidence: 'weak',
    };
  }
  return {
    ...base,
    text: `Does "${identity.idField}" identify one ${name}?`,
    evidence:
      `Its value was different for every ${name} in each list the server returned, ` +
      (seen.compared
        ? 'and it stayed the same between the readings before and after the job.'
        : 'and nothing showed it changing for the same one.') +
      changing +
      summing,
    proposed: identity.idField,
    confidence: seen.recordCount > 1 ? 'moderate' : 'weak',
  };
}

/** `"a"`, `"a" and "b"`, `"a", "b" and "c"`. Grammar, not vocabulary. */
function quoteList(names: readonly string[]): string {
  const quoted = names.map((name) => `"${name}"`);
  if (quoted.length <= 1) return quoted[0] ?? '';
  return `${quoted.slice(0, -1).join(', ')} and ${quoted[quoted.length - 1]}`;
}

/** Rows grouped by which record they are, once what names a record is known. */
function byRecord(evidence: EntityEvidence, naming: readonly string[]): Map<string, Record<string, unknown>[]> {
  const grouped = new Map<string, Record<string, unknown>[]>();
  for (const row of evidence.rows) {
    const key =
      naming.length === 1
        ? String(row[naming[0]!])
        : JSON.stringify(naming.map((field) => row[field] ?? null));
    const bucket = grouped.get(key) ?? [];
    bucket.push(row);
    grouped.set(key, bucket);
  }
  return grouped;
}

function changesForSameRecord(
  records: Map<string, Record<string, unknown>[]>,
  field: string,
): boolean {
  for (const rows of records.values()) {
    const seen = new Set(rows.map((row) => String(row[field])));
    if (seen.size > 1) return true;
  }
  return false;
}

/**
 * Whether a field holds a closed set of values.
 *
 * Measured against the number of distinct *records*, not the number of
 * observations. A status has fewer values than there are records, because
 * records share them. A note has one value per record, and only looks repeated
 * because the same record was read twice.
 */
function isClosedSet(
  evidence: EntityEvidence,
  field: string,
  recordCount: number,
): boolean {
  const distinct = distinctOf(evidence, field);
  if (distinct.size < 2 || distinct.size > MAX_ENUM_VALUES) return false;
  if (recordCount < 2 || distinct.size >= recordCount) return false;
  return [...distinct].every((value) => value.length <= MAX_ENUM_VALUE_LENGTH);
}

function typeOf(
  evidence: EntityEvidence,
  field: string,
  recordCount: number,
): FieldType {
  const values = valuesOf(evidence, field);
  if (values.length === 0) return 'string';
  if (values.every((value) => typeof value === 'boolean')) return 'boolean';
  if (values.every((value) => typeof value === 'number')) return 'number';
  if (values.every((value) => typeof value === 'string' && ISO_8601.test(value))) {
    return 'timestamp';
  }
  return isClosedSet(evidence, field, recordCount) ? 'enum' : 'string';
}

/** The smallest step ever observed, which is what a boundary case needs. */
function precisionOf(evidence: EntityEvidence, field: string): number {
  let decimals = 0;
  for (const value of valuesOf(evidence, field)) {
    if (typeof value !== 'number') continue;
    const text = String(value);
    const dot = text.indexOf('.');
    if (dot >= 0) decimals = Math.max(decimals, text.length - dot - 1);
  }
  return decimals === 0 ? 1 : Number(`1e-${decimals}`);
}

/** Turns a server's own name for a collection into a record name. */
function entityNameFrom(evidence: EntityEvidence, index: number): string {
  const [best] = [...evidence.containerNames.entries()].sort((a, b) => b[1] - a[1]);
  const raw = best?.[0];
  if (!raw) return `Record${index + 1}`;
  const singular = raw.length > 3 && raw.endsWith('s') ? raw.slice(0, -1) : raw;
  const cleaned = singular.replace(/[^A-Za-z0-9]+/g, ' ').trim();
  if (cleaned.length === 0) return `Record${index + 1}`;
  return cleaned
    .split(' ')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
}

function uniqueName(proposed: string, taken: Set<string>): string {
  let name = proposed;
  for (let suffix = 2; taken.has(name); suffix += 1) name = `${proposed}${suffix}`;
  taken.add(name);
  return name;
}

const ROLE_OPTIONS: readonly FieldRole[] = [
  'identifier',
  'quantity',
  'status',
  'actor',
  'timestamp',
  'flag',
  'freetext',
];

const UNIT_OPTIONS: readonly Unit[] = [
  'currency',
  'count',
  'duration_days',
  'duration_hours',
  'duration_ms',
  'score',
  'mass_kg',
  'percent',
];

export function induceSchema(observations: readonly PayloadObservation[]): InducedSchema {
  const collected = new Map<string, EntityEvidence>();
  const totals = new Map<string, TotalTally>();
  observations.forEach((observation, source) => {
    // The same rewrite row extraction applies, so what is recognised here is
    // recognised at run time: tagged cells become values, wrapped rows become
    // rows.
    collect(canonicalisePayload(observation.payload), '', 0, collected, { source, totals });
  });
  const pairs = readingPairs(observations);

  const worthKeeping = [...collected.values()].filter(
    (entity) => entity.fieldOrder.length >= MIN_FIELDS_FOR_RECORD,
  );
  const ignored = [...collected.values()]
    .filter((entity) => entity.fieldOrder.length < MIN_FIELDS_FOR_RECORD)
    .map((entity) => ({ signature: entity.signature, seen: entity.rows.length }));

  const questions: SchemaQuestion[] = [];
  const entities: EntitySchema[] = [];
  const idValuesByEntity = new Map<string, Set<string>>();

  // Two shapes that arrived under the same container name — two reads that
  // each answer with `rows` — are two record types, and must not share a name
  // or their rows would land in one table and collide by identifier.
  const taken = new Set<string>();
  const names = worthKeeping.map((evidence, index) => uniqueName(entityNameFrom(evidence, index), taken));
  const partsOfTotals = resolveTotals(totals, worthKeeping, names);

  worthKeeping.forEach((evidence, index) => {
    const name = names[index]!;
    // What the recording showed changing for the same record, and what adds up
    // to a total, describe a record. Neither may be what names one.
    const totalsOf = partsOfTotals.get(evidence.signature) ?? new Map<string, string>();
    const { changed, compared } = changedFields(evidence, pairs);
    const identity = chooseIdentity(evidence, new Set([...changed, ...totalsOf.keys()]));
    const naming = identity.unestablished ? [] : (identity.keyFields ?? [identity.idField]);
    const records = naming.length > 0 ? byRecord(evidence, naming) : new Map<string, Record<string, unknown>[]>();
    const recordCount = naming.length > 0 ? records.size : evidence.rows.length;

    questions.push({
      id: `q_name_${name}`,
      kind: 'entity_name',
      entity: name,
      text: `Is "${name}" the right name for this kind of record?`,
      evidence:
        `${recordCount} distinct record(s) seen, with fields: ` +
        `${evidence.signature.split('|').join(', ')}.`,
      proposed: name,
      options: [],
      confidence: evidence.containerNames.size > 0 ? 'moderate' : 'weak',
    });
    questions.push(
      identityQuestion(name, evidence, identity, {
        changed: evidence.fieldOrder.filter((field) => changed.has(field)),
        parts: evidence.fieldOrder.filter((field) => totalsOf.has(field)),
        compared,
        recordCount,
      }),
    );

    const fields: FieldSchema[] = [];
    for (const fieldName of evidence.fieldOrder) {
      const type = typeOf(evidence, fieldName, recordCount);
      const nullable = nullsOf(evidence, fieldName) > 0;
      const isId = naming.includes(fieldName);
      const changes = changed.has(fieldName) || (naming.length > 0 && changesForSameRecord(records, fieldName));
      const distinct = distinctOf(evidence, fieldName);
      const whole = totalsOf.get(fieldName);

      const { role, confidence, reason } = proposeRole({ type, isId, changes });

      const field: FieldSchema = {
        name: fieldName,
        type,
        nullable,
        role,
        ...(type === 'enum' ? { enumValues: [...distinct].sort() } : {}),
        ...(whole !== undefined ? { totals: whole } : {}),
      };
      if (role === 'quantity' || role === 'timestamp') {
        field.precision = type === 'number' ? precisionOf(evidence, fieldName) : 1;
        // A unit cannot be seen. It has to be said.
        field.unit = 'count';
        questions.push({
          id: `q_unit_${name}_${fieldName}`,
          kind: 'unit',
          entity: name,
          field: fieldName,
          text: `What is "${fieldName}" measured in?`,
          evidence:
            `${sampleOf(distinct)} The unit decides what "one more than the limit" means, ` +
            'so a boundary case cannot sit on the boundary until this is answered.',
          proposed: 'count',
          options: UNIT_OPTIONS,
          confidence: 'weak',
        });
      }
      fields.push(field);

      if (!isId) {
        questions.push({
          id: `q_role_${name}_${fieldName}`,
          kind: 'field_role',
          entity: name,
          field: fieldName,
          text: `What kind of thing is "${fieldName}"?`,
          evidence: `${reason}${whole !== undefined ? ` Its values add up to ${whole}.` : ''} ${sampleOf(distinct)}`.trim(),
          proposed: role,
          options: ROLE_OPTIONS,
          confidence,
        });
      }

      // Whether an outsider can write here is the one annotation with security
      // weight — it decides where injection payloads are placed — and there is
      // no structural signal for it whatsoever. So it is always asked, and
      // always defaults to the safe answer.
      if (type === 'string' && role === 'freetext' && !isId) {
        questions.push({
          id: `q_untrusted_${name}_${fieldName}`,
          kind: 'untrusted',
          entity: name,
          field: fieldName,
          text: `Can somebody outside your organisation write "${fieldName}"?`,
          evidence:
            'Nothing about the data can answer this. It decides where RigorRun places ' +
            'injection payloads when it tests your agent.',
          proposed: 'no',
          options: ['no', 'yes'],
          confidence: 'weak',
        });
      }
    }

    entities.push({
      name,
      idField: identity.idField,
      ...(identity.unestablished
        ? { identity: 'unestablished' as const }
        : identity.keyFields !== undefined
          ? { keyFields: identity.keyFields }
          : {}),
      fields,
      mutable: true,
      appendOnly: false,
    });

    // Only a record named by one field can be pointed at by another's field.
    if (!identity.unestablished && identity.keyFields === undefined) {
      idValuesByEntity.set(name, distinctOf(evidence, identity.idField));
    }
  });

  const relationships = proposeRelationships(worthKeeping, entities, idValuesByEntity, questions);

  // A field whose every value is another record's identifier is a reference,
  // whatever it looked like in isolation. Seen on its own, `venueId` is three
  // values repeated across four records, which is indistinguishable from a
  // lifecycle; seen against the venues, it is obviously a link. The
  // relationship pass knows something the field pass could not, so it gets the
  // last word — and the question that was asked on the weaker evidence is
  // withdrawn rather than left to contradict the schema.
  reclassifyReferences(entities, relationships, questions);

  return { schema: { entities, relationships }, questions, ignored };
}

function sampleOf(distinct: Set<string>): string {
  const sample = [...distinct].slice(0, 4).map((value) =>
    value.length > 40 ? `${value.slice(0, 40)}\u2026` : value,
  );
  return sample.length > 0 ? `Values seen: ${sample.join(', ')}.` : 'No values were seen.';
}

function proposeRole(input: {
  type: FieldType;
  isId: boolean;
  changes: boolean;
}): { role: FieldRole; confidence: SchemaQuestion['confidence']; reason: string } {
  if (input.isId) {
    return { role: 'identifier', confidence: 'strong', reason: 'It identifies the record.' };
  }
  if (input.type === 'boolean') {
    return { role: 'flag', confidence: 'strong', reason: 'Every value was true or false.' };
  }
  if (input.type === 'timestamp') {
    return { role: 'timestamp', confidence: 'strong', reason: 'Every value was a date.' };
  }
  if (input.type === 'enum') {
    return input.changes
      ? {
          role: 'status',
          confidence: 'strong',
          reason: 'A small set of values, and the same record was seen holding two of them.',
        }
      : {
          role: 'status',
          confidence: 'moderate',
          reason: 'A small, repeated set of values, though none was seen changing.',
        };
  }
  if (input.type === 'number') {
    return {
      role: 'quantity',
      confidence: 'moderate',
      reason: 'A number that does not identify anything, so thresholds may apply.',
    };
  }
  // A string that is not an identifier, a date or a closed set. It could be a
  // person, a reference or prose, and nothing structural separates those — so
  // the answer is the one that enforces nothing.
  return {
    role: 'freetext',
    confidence: 'weak',
    reason: 'Free text as far as RigorRun can tell.',
  };
}

/**
 * A link, proposed only when one record's values are literally another
 * record's identifiers.
 *
 * Not "this field is called venueId and there is a Venue" — that is the name
 * trap again. This is "every value this field held was an id that a Venue
 * actually has", which is evidence, and which would still work if the field
 * were called `q7`.
 */
function proposeRelationships(
  collected: readonly EntityEvidence[],
  entities: readonly EntitySchema[],
  idValues: Map<string, Set<string>>,
  questions: SchemaQuestion[],
): RelationshipSchema[] {
  const relationships: RelationshipSchema[] = [];

  collected.forEach((evidence, index) => {
    const from = entities[index];
    if (!from) return;
    for (const fieldName of evidence.fieldOrder) {
      if (fieldName === from.idField) continue;
      const distinct = distinctOf(evidence, fieldName);
      if (distinct.size === 0) continue;

      for (const target of entities) {
        if (target.name === from.name) continue;
        const targetIds = idValues.get(target.name);
        if (!targetIds || targetIds.size === 0) continue;
        // Every value, not merely some: a partial overlap is a coincidence.
        const overlap = [...distinct].filter((value) => targetIds.has(value));
        if (overlap.length !== distinct.size) continue;

        relationships.push({
          name: `${from.name.toLowerCase()}_${target.name.toLowerCase()}`,
          from: from.name,
          to: target.name,
          via: { kind: 'fk', field: fieldName },
          cardinality: 'one',
          // Whether the system *requires* the link is not observable from data
          // that happens to have it. Assume not, and ask.
          required: false,
        });
        questions.push({
          id: `q_rel_${from.name}_${fieldName}`,
          kind: 'relationship',
          entity: from.name,
          field: fieldName,
          text: `Does every ${from.name} have to name ${article(target.name)} ${target.name}?`,
          evidence:
            `Every value of "${fieldName}" was an identifier ${article(target.name)} ` +
            `${target.name} actually has ` +
            `(${overlap.slice(0, 3).join(', ')}).`,
          proposed: 'optional',
          options: ['optional', 'required'],
          confidence: 'moderate',
        });
        break;
      }
    }
  });

  return relationships;
}

/** Promotes every relationship's source field to an identifier. */
function reclassifyReferences(
  entities: readonly EntitySchema[],
  relationships: readonly RelationshipSchema[],
  questions: SchemaQuestion[],
): void {
  for (const relationship of relationships) {
    const via = relationship.via;
    if (via.kind !== 'fk') continue;
    const entity = entities.find((candidate) => candidate.name === relationship.from);
    const field = entity?.fields.find((candidate) => candidate.name === via.field);
    if (!entity || !field) continue;

    field.role = 'identifier';
    field.type = 'string';
    delete field.enumValues;

    const stale = questions.findIndex(
      (question) => question.id === `q_role_${entity.name}_${field.name}`,
    );
    if (stale >= 0) {
      questions[stale] = {
        ...questions[stale]!,
        proposed: 'identifier',
        confidence: 'strong',
        evidence:
          `Every value of "${field.name}" is an identifier that a ${relationship.to} has, ` +
          'so this names another record rather than describing this one.',
      };
    }
  }
}

/** "a Venue" / "an Organiser". Grammar, not vocabulary. */
function article(word: string): string {
  return /^[aeiou]/i.test(word) ? 'an' : 'a';
}

// ------------------------------------------------------------------- answers

/** One person's answer to one question. */
export interface SchemaAnswer {
  questionId: string;
  /** The chosen value. For `untrusted`, "yes" or "no". */
  value: string;
}

export interface AppliedSchema {
  schema: EnvironmentSchema;
  /** Questions still unanswered, in the order they were asked. */
  outstanding: SchemaQuestion[];
}

/**
 * Folds a person's answers back into the draft.
 *
 * Everything left unanswered stays as RigorRun guessed it, and stays *listed*.
 * That is the same discipline the contract already follows — a rule nobody
 * confirmed cannot fail an agent — applied one level down, to the schema those
 * rules are written against. A confidently wrong `role` corrupts thresholds,
 * boundary mutation and the projection at once, and does it silently, so the
 * unanswered ones need to keep being visible rather than ageing into facts.
 */
export function applySchemaAnswers(
  induced: InducedSchema,
  answers: readonly SchemaAnswer[],
): AppliedSchema {
  const byId = new Map(answers.map((answer) => [answer.questionId, answer.value]));
  const schema: EnvironmentSchema = structuredClone(induced.schema);

  for (const question of induced.questions) {
    const value = byId.get(question.id);
    if (value === undefined) continue;

    const entity = schema.entities.find((candidate) => candidate.name === question.entity);
    if (!entity) continue;
    const field = question.field
      ? entity.fields.find((candidate) => candidate.name === question.field)
      : undefined;

    switch (question.kind) {
      case 'entity_name': {
        renameEntity(schema, entity.name, value);
        break;
      }
      case 'id_field': {
        if (entity.fields.some((candidate) => candidate.name === value)) {
          entity.idField = value;
          // A person named the field, which replaces whatever was induced.
          delete entity.keyFields;
          delete entity.identity;
        }
        break;
      }
      case 'field_role': {
        if (!field) break;
        field.role = value as FieldRole;
        // A role change can invalidate what the type implied. A quantity needs
        // a unit and a precision to be mutable at a boundary at all, and a
        // field promoted to one without them would silently generate cases that
        // sit next to the boundary rather than on it.
        if (field.role === 'quantity' || field.role === 'timestamp') {
          field.unit ??= 'count';
          field.precision ??= 1;
        } else {
          delete field.unit;
          delete field.precision;
        }
        break;
      }
      case 'unit': {
        if (!field) break;
        field.unit = value as Unit;
        break;
      }
      case 'untrusted': {
        if (!field) break;
        if (value === 'yes') field.untrusted = true;
        else delete field.untrusted;
        break;
      }
      case 'relationship': {
        const relationship = schema.relationships.find(
          (candidate) =>
            candidate.from === question.entity &&
            candidate.via.kind === 'fk' &&
            candidate.via.field === question.field,
        );
        if (relationship) relationship.required = value === 'required';
        break;
      }
    }
  }

  const outstanding = induced.questions.filter((question) => !byId.has(question.id));
  return { schema, outstanding };
}

/** Renames an entity and everything that points at it. */
function renameEntity(schema: EnvironmentSchema, from: string, to: string): void {
  if (from === to || to.trim().length === 0) return;
  for (const entity of schema.entities) {
    if (entity.name === from) entity.name = to;
  }
  for (const relationship of schema.relationships) {
    if (relationship.from === from) relationship.from = to;
    if (relationship.to === from) relationship.to = to;
  }
}
