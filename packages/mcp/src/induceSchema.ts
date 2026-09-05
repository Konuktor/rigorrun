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

/** One thing a tool gave back, and which tool gave it. */
export interface PayloadObservation {
  tool: string;
  /** The `structuredContent` of a result, or a parsed JSON body. */
  payload: unknown;
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
}

const MIN_FIELDS_FOR_RECORD = 2;
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
        collect(entry, containerName, depth + 1, into);
      }
    }
    for (const [evidence, indices] of group) evidence.collections.push(indices);
    return;
  }

  if (typeof payload !== 'object' || payload === null) return;
  const object = payload as Record<string, unknown>;

  if (isRecordLike(object)) {
    const evidence = evidenceFor(object, containerName, into);
    evidence.rows.push(object);
    evidence.collections.push([evidence.rows.length - 1]);
  }
  // Keep walking regardless: a wrapper like `{ bookings: [...] }` is not itself
  // a record, and a record may carry a nested collection.
  for (const [key, value] of Object.entries(object)) {
    if (typeof value === 'object' && value !== null) {
      collect(value, key, depth + 1, into);
    }
  }
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
 */
function chooseIdField(evidence: EntityEvidence): string | undefined {
  const candidates = evidence.fieldOrder.filter((name) => {
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
  // records; ties fall back to declaration order, which is why this produces a
  // question rather than a decision.
  return candidates.sort(
    (a, b) => distinctOf(evidence, b).size - distinctOf(evidence, a).size,
  )[0];
}

/** Rows grouped by which record they are, once an identifier is known. */
function byRecord(evidence: EntityEvidence, idField: string): Map<string, Record<string, unknown>[]> {
  const grouped = new Map<string, Record<string, unknown>[]>();
  for (const row of evidence.rows) {
    const key = String(row[idField]);
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
  for (const observation of observations) {
    collect(observation.payload, '', 0, collected);
  }

  const worthKeeping = [...collected.values()].filter(
    (entity) => entity.fieldOrder.length >= MIN_FIELDS_FOR_RECORD,
  );
  const ignored = [...collected.values()]
    .filter((entity) => entity.fieldOrder.length < MIN_FIELDS_FOR_RECORD)
    .map((entity) => ({ signature: entity.signature, seen: entity.rows.length }));

  const questions: SchemaQuestion[] = [];
  const entities: EntitySchema[] = [];
  const idValuesByEntity = new Map<string, Set<string>>();

  worthKeeping.forEach((evidence, index) => {
    const name = entityNameFrom(evidence, index);
    const idField = chooseIdField(evidence);
    const records = idField ? byRecord(evidence, idField) : new Map();
    const recordCount = idField ? records.size : evidence.rows.length;

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

    if (!idField) {
      questions.push({
        id: `q_id_${name}`,
        kind: 'id_field',
        entity: name,
        text: `Which field identifies one ${name}?`,
        evidence: 'No field held a value that was unique within every list the server returned.',
        proposed: '',
        options: evidence.fieldOrder,
        confidence: 'weak',
      });
    } else {
      questions.push({
        id: `q_id_${name}`,
        kind: 'id_field',
        entity: name,
        text: `Does "${idField}" identify one ${name}?`,
        evidence:
          `Its value was different for every ${name} in each list the server returned, ` +
          `and never changed for the same one.`,
        proposed: idField,
        options: evidence.fieldOrder,
        confidence: recordCount > 1 ? 'moderate' : 'weak',
      });
    }

    const fields: FieldSchema[] = [];
    for (const fieldName of evidence.fieldOrder) {
      const type = typeOf(evidence, fieldName, recordCount);
      const nullable = nullsOf(evidence, fieldName) > 0;
      const isId = fieldName === idField;
      const changes = idField ? changesForSameRecord(records, fieldName) : false;
      const distinct = distinctOf(evidence, fieldName);

      const { role, confidence, reason } = proposeRole({ type, isId, changes });

      const field: FieldSchema = {
        name: fieldName,
        type,
        nullable,
        role,
        ...(type === 'enum' ? { enumValues: [...distinct].sort() } : {}),
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
          evidence: `${reason} ${sampleOf(distinct)}`.trim(),
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
      idField: idField ?? fields[0]?.name ?? 'id',
      fields,
      mutable: true,
      appendOnly: false,
    });

    if (idField) idValuesByEntity.set(name, distinctOf(evidence, idField));
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
