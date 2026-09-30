/**
 * Inducing a schema from a real server's real answers.
 *
 * The test drives the venue desk over MCP, keeps whatever comes back, and asks
 * what RigorRun made of it. That matters more than a unit test over a
 * hand-written payload, because the failure mode being guarded against is
 * RigorRun quietly understanding only the shapes it invented.
 *
 * Read the assertions as two claims. That structure alone carries a surprising
 * amount — identity, closed sets, links, precision. And that it stops exactly
 * where structure stops, and asks, rather than guessing from a field's name.
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { normalizeToolResult } from '@rigorrun/connector';
import { McpConnection, induceSchema, type McpStdioConfig, type PayloadObservation } from '../src/index.ts';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const DESK: McpStdioConfig = {
  transport: 'stdio',
  command: join(root, 'node_modules', '.bin', 'tsx'),
  args: [join(root, 'fixtures', 'external', 'mcp-venue-desk', 'src', 'stdio.ts')],
};

let induced: ReturnType<typeof induceSchema>;

beforeAll(async () => {
  const connection = await McpConnection.open(DESK);
  const observations: PayloadObservation[] = [];
  const watch = async (tool: string, args: Record<string, unknown> = {}) => {
    const result = await connection.call(tool, args);
    if (result.structured !== undefined) observations.push({ tool, payload: result.structured });
  };

  // Exactly what a person demonstrating the job would touch, plus the reads
  // around it. Nothing is fabricated for the benefit of the inference.
  await watch('list_venues');
  await watch('list_organisers');
  await watch('find_bookings');
  await watch('get_booking', { bookingId: 'BKG-4001' });
  await watch('record_signoff', { bookingId: 'BKG-4001', approver: 'Dana Whitlock' });
  await watch('confirm_booking', { bookingId: 'BKG-4001' });
  await watch('get_booking', { bookingId: 'BKG-4001' });

  induced = induceSchema(observations);
  await connection.close();
}, 60_000);

afterAll(() => undefined);

describe('what structure alone reveals', () => {
  it('finds the record shapes the server actually returns', () => {
    const names = induced.schema.entities.map((entity) => entity.name).sort();
    // Named from the server's own container keys, singularised. Every one of
    // these is a question the operator can override.
    expect(names).toEqual(['Booking', 'Organiser', 'Venue']);
  });

  it('picks the field that is unique and never changes as the identifier', () => {
    const byName = Object.fromEntries(induced.schema.entities.map((e) => [e.name, e]));
    expect(byName['Booking']?.idField).toBe('bookingId');
    expect(byName['Venue']?.idField).toBe('venueId');
    expect(byName['Organiser']?.idField).toBe('organiserId');
  });

  it('reads a small repeated set of values as a lifecycle, and knows one moved', () => {
    const booking = induced.schema.entities.find((e) => e.name === 'Booking')!;
    const status = booking.fields.find((f) => f.name === 'bookingStatus')!;
    expect(status.type).toBe('enum');
    expect(status.role).toBe('status');

    // The strong evidence is that the *same* booking was seen holding two
    // different values, which is the only structural difference between a
    // lifecycle and a label.
    const question = induced.questions.find((q) => q.id === 'q_role_Booking_bookingStatus')!;
    expect(question.confidence).toBe('strong');
    expect(question.evidence).toMatch(/seen holding two of them/);
  });

  it('treats a plain number as a magnitude thresholds could apply to', () => {
    const booking = induced.schema.entities.find((e) => e.name === 'Booking')!;
    const deposit = booking.fields.find((f) => f.name === 'depositAmount')!;
    expect(deposit.type).toBe('number');
    expect(deposit.role).toBe('quantity');
  });

  it('lets the link evidence overrule the field evidence', () => {
    // Seen alone, `venueId` is three values repeated across four records —
    // indistinguishable from a lifecycle, and that is genuinely what the field
    // pass concluded. Seen against the venues it is obviously a reference. The
    // pass that knows more gets the last word, and the question asked on the
    // weaker evidence is corrected rather than left to contradict the schema.
    const booking = induced.schema.entities.find((e) => e.name === 'Booking')!;
    const venueRef = booking.fields.find((f) => f.name === 'venueId')!;
    expect(venueRef.role).toBe('identifier');
    expect(venueRef.type).toBe('string');
    expect(venueRef.enumValues).toBeUndefined();

    const question = induced.questions.find((q) => q.id === 'q_role_Booking_venueId')!;
    expect(question.proposed).toBe('identifier');
    expect(question.confidence).toBe('strong');
    expect(question.evidence).toMatch(/names another record/);
  });

  it('proposes a link only where one record’s values are another’s identifiers', () => {
    const links = induced.schema.relationships.map((r) => `${r.from}.${describeVia(r.via)}->${r.to}`);
    expect(links).toEqual(
      expect.arrayContaining(['Booking.venueId->Venue', 'Booking.organiserId->Organiser']),
    );
    // And nowhere else. `note` and `bookingStatus` are not links, and nothing
    // about their names was consulted to decide that.
    expect(links.some((link) => link.includes('note'))).toBe(false);
  });
});

describe('where structure stops, it asks', () => {
  it('cannot see a unit, so it never claims one', () => {
    const unit = induced.questions.find((q) => q.id === 'q_unit_Booking_depositAmount')!;
    expect(unit.kind).toBe('unit');
    expect(unit.confidence).toBe('weak');
    expect(unit.options).toEqual(expect.arrayContaining(['currency', 'mass_kg', 'count']));
    // The evidence is the values, not a conclusion drawn from them.
    expect(unit.evidence).toMatch(/Values seen/);
  });

  it('always asks who can write free text, because that decides where injection goes', () => {
    const untrusted = induced.questions.find((q) => q.id === 'q_untrusted_Booking_note')!;
    expect(untrusted.proposed).toBe('no');
    expect(untrusted.evidence).toMatch(/Nothing about the data can answer this/);
    expect(untrusted.evidence).toMatch(/injection payloads/);
  });

  it('does not mistake a person’s name for prose with any confidence', () => {
    // `signedOffBy` is an actor. Nothing structural says so — it is a nullable
    // string like any other — so the guess is the one that enforces nothing,
    // and it is asked with low confidence rather than asserted.
    const role = induced.questions.find((q) => q.id === 'q_role_Booking_signedOffBy')!;
    expect(role.proposed).toBe('freetext');
    expect(role.confidence).toBe('weak');
    expect(role.options).toContain('actor');
  });

  it('attaches evidence to every question it asks', () => {
    expect(induced.questions.length).toBeGreaterThan(5);
    for (const question of induced.questions) {
      expect(question.evidence.length).toBeGreaterThan(10);
      expect(question.text).toMatch(/\?$/);
    }
  });
});

describe('the vocabulary trap', () => {
  it('reaches the same conclusions when every field is renamed to nonsense', () => {
    // The real test of "structure, not names". Same data, names destroyed.
    const rename = (row: Record<string, unknown>, map: Record<string, string>) =>
      Object.fromEntries(Object.entries(row).map(([k, v]) => [map[k] ?? k, v]));

    const map: Record<string, string> = {
      bookingId: 'k1',
      venueId: 'k2',
      organiserId: 'k3',
      depositAmount: 'k4',
      bookingStatus: 'k5',
      signedOffBy: 'k6',
      note: 'k7',
      venueName: 'k8',
      capacity: 'k9',
    };

    const rows = [
      { bookingId: 'B-1', venueId: 'V-1', organiserId: 'O-1', depositAmount: 900, bookingStatus: 'held', signedOffBy: null, note: 'x' },
      { bookingId: 'B-1', venueId: 'V-1', organiserId: 'O-1', depositAmount: 900, bookingStatus: 'confirmed', signedOffBy: 'D', note: 'x' },
      { bookingId: 'B-2', venueId: 'V-2', organiserId: 'O-1', depositAmount: 250, bookingStatus: 'held', signedOffBy: null, note: 'y' },
      { bookingId: 'B-3', venueId: 'V-1', organiserId: 'O-1', depositAmount: 500, bookingStatus: 'cancelled', signedOffBy: null, note: 'z' },
    ];

    const named = induceSchema([{ tool: 't', payload: { bookings: rows } }]);
    const anonymous = induceSchema([
      { tool: 't', payload: { bookings: rows.map((row) => rename(row, map)) } },
    ]);

    const shapeOf = (result: typeof named) =>
      result.schema.entities[0]!.fields
        .map((field) => `${field.type}:${field.role}`)
        .sort();

    expect(shapeOf(anonymous)).toEqual(shapeOf(named));
    expect(anonymous.schema.entities[0]!.idField).toBe('k1');
  });
});

function describeVia(via: { kind: string; field?: string }): string {
  return via.field ?? via.kind;
}

describe('shapes the audit found in the wild', () => {
  // A SQL bridge answers every query with a table of typed cells. Read as
  // records, each cell became a two-field entity keyed by its own value and
  // no row ever existed to verify against (audit finding R-3).
  const cell = (kind: string, value: unknown) => ({ kind, value });
  const tasks = {
    rows: [
      { columns: { amount: cell('Real', 120.5), id: cell('Integer', 1), owner: cell('Text', 'ada'), status: cell('Text', 'open'), title: cell('Text', 'Prepare invoice') } },
      { columns: { amount: cell('Real', 80), id: cell('Integer', 2), owner: cell('Text', 'bo'), status: cell('Text', 'open'), title: cell('Text', 'Review contract') } },
      { columns: { amount: cell('Real', 0), id: cell('Integer', 3), owner: cell('Text', 'ada'), status: cell('Text', 'done'), title: cell('Text', 'Archive old files') } },
    ],
    rows_changed: 0,
  };
  const log = {
    rows: [{ columns: { action: cell('Text', 'completed'), id: cell('Integer', 1), note: cell('Text', 'seed'), task_id: cell('Integer', 3) } }],
    rows_changed: 0,
  };

  it('induces the rows, keyed by their identifier, not the cells', () => {
    const result = induceSchema([{ tool: 'query', payload: tasks }]);
    expect(result.schema.entities).toHaveLength(1);
    const [entity] = result.schema.entities;
    expect(entity!.idField).toBe('id');
    expect(entity!.fields.map((f) => f.name).sort()).toEqual(['amount', 'id', 'owner', 'status', 'title']);
    expect(entity!.name).not.toBe('Id');
    expect(entity!.name).not.toBe('Column');
  });

  it('keeps two record types apart when two reads use the same container name', () => {
    const result = induceSchema([
      { tool: 'query', payload: tasks },
      { tool: 'query', payload: log },
    ]);
    const names = result.schema.entities.map((e) => e.name);
    expect(new Set(names).size).toBe(2);
    expect(names.every((name) => name.startsWith('Row'))).toBe(true);
  });

  it('sees the record inside a JSON text block once the result is normalised', () => {
    // What the setup probe used to hand it was the content-block array. What
    // every interpreter hands it now is the normaliser's reading.
    const normalized = normalizeToolResult({ content: [{ type: 'text', text: '{"timers": [{"timerId": "t-1", "running": true}, {"timerId": "t-2", "running": false}]}' }] });
    const result = induceSchema([{ tool: 'read', payload: normalized.payload }]);
    expect(result.schema.entities.map((e) => e.fields.map((f) => f.name).sort())).toEqual([['running', 'timerId']]);
  });
});
