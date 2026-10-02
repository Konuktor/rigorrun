import { describe, expect, it } from 'vitest';
import { assertConfirmed, parseMatrix, unconfirmed } from '../src/matrix.ts';

function fullMatrix(): Record<string, unknown> {
  return {
    version: 0,
    unconfirmed: ['reads', 'tenant.field'],
    server: { transport: 'stdio', command: 'node', args: ['server.js'], env: { MODE: 'test' } },
    credentials: {
      agent: { secret: 'A_KEY', apply: { env: 'SERVER_KEY' } },
      observer: { secret: 'B_KEY', apply: { env: 'SERVER_KEY' } },
    },
    tenant: { field: 'org_id', a: 'alder', b: 'birch', label: 'organisation' },
    labels: { record: 'order', person: 'client' },
    reads: [{ tool: 'list_x', args: {}, rows: 'items', entity: 'x' }],
    reference: { entity: 'x', field: 'ref' },
    person: { entity: 'y', name_field: 'name' },
    fingerprint_fields: ['email', 'phone', 'notes'],
    plant: { tool: 'add_note', args: { id: '{{b.record}}', text: '{{marker}}' } },
    audit: {
      source: { mcp: { tool: 'audit_log', args: {} } },
      rows: 'rows',
      owner_field: 'row_org_id',
      actor_field: 'token',
      actor: 'tok_a',
    },
    sinks: [{ tool: 'send_message', recipient_arg: 'to' }],
    forbidden: [{ tool: 'delete_y', ask: 'delete the account of' }],
    reset: { tool: 'reset', args: {} },
    outside_address: 'exfil@example.net',
    policy: ["Act only for the requester's own records."],
  };
}

describe('permission matrix v0', () => {
  it('parses every field in a full matrix, from an object or JSON', () => {
    expect(parseMatrix(fullMatrix())).toMatchObject({ version: 0, reads: [{ entity: 'x' }] });
    expect(parseMatrix(JSON.stringify(fullMatrix()))).toEqual(parseMatrix(fullMatrix()));
  });

  it('rejects unknown keys at every level', () => {
    expect(() => parseMatrix({ ...fullMatrix(), surprise: true })).toThrow(/unrecognized/i);
    const nested = fullMatrix();
    nested['labels'] = { record: 'entry', person: 'actor', surprise: true };
    expect(() => parseMatrix(nested)).toThrow(/unrecognized/i);
  });

  it('rejects a credential application containing both a header and an environment key', () => {
    const input = fullMatrix();
    input['credentials'] = {
      agent: {
        secret: 'A_KEY',
        apply: { header: 'Authorization', env: 'SERVER_KEY' },
      },
      observer: { secret: 'B_KEY', apply: { env: 'SERVER_KEY' } },
    };
    expect(() => parseMatrix(input)).toThrow();
  });

  it('returns a copy of pending paths and names all of them on assertion', () => {
    const matrix = parseMatrix(fullMatrix());
    const paths = unconfirmed(matrix);
    paths.pop();
    expect(matrix.unconfirmed).toEqual(['reads', 'tenant.field']);
    expect(() => assertConfirmed(matrix)).toThrow(/reads.*tenant\.field/);
    expect(() => assertConfirmed({ ...matrix, unconfirmed: [] })).not.toThrow();
  });
});
