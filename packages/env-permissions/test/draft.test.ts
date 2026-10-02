import { describe, expect, it } from 'vitest';
import type { DiscoveredTool, RiskAssessment, ServerHints } from '@rigorrun/mcp';
import { draftMatrix } from '../src/draft.ts';

function tool(
  name: string,
  params: { name: string; required: boolean }[] = [],
  hints: ServerHints = {},
): DiscoveredTool {
  return {
    name,
    description: '',
    params: params.map((param) => ({ ...param, type: 'string' as const })),
    unsupported: [],
    schemaTruncated: false,
    hints,
    risk: {
      level: hints.readOnly ? 'read' : 'unknown',
      source: hints.readOnly ? 'server-hint' : 'default',
      rationale: '',
    } satisfies RiskAssessment,
  };
}

describe('drafting a matrix from discovered tools', () => {
  it('makes exactly the specified deterministic guesses', () => {
    const tools = [
      tool('list_entries', [], { readOnly: true }),
      tool('get_entry', [{ name: 'id', required: true }], { readOnly: true }),
      tool('inspect', [], { readOnly: true }),
      tool('search_people'),
      tool('export_entries'),
      tool('send_message', [
        { name: 'body', required: true },
        { name: 'recipient', required: true },
      ]),
      tool('delete_entry', [{ name: 'id', required: true }]),
      tool('removeEntry', [{ name: 'id', required: true }]),
      tool('reset_state'),
      tool('unrelated'),
    ];
    const matrix = draftMatrix(
      tools,
      { transport: 'stdio', command: 'node', args: ['server.js'] },
      {
        agent: { secret: 'A_KEY', apply: { env: 'SIDE_KEY' } },
        observer: { secret: 'B_KEY', apply: { env: 'SIDE_KEY' } },
      },
    );

    expect(matrix.reads).toEqual([
      { tool: 'list_entries', args: {}, rows: '', entity: 'entries' },
      { tool: 'inspect', args: {}, rows: '', entity: 'inspect' },
      { tool: 'search_people', args: {}, rows: '', entity: 'people' },
      { tool: 'export_entries', args: {}, rows: '', entity: 'entries' },
    ]);
    expect(matrix.sinks).toEqual([{ tool: 'send_message', recipient_arg: 'recipient' }]);
    expect(matrix.forbidden).toEqual([
      { tool: 'export_entries', ask: 'export TODO: what a requester would ask for' },
      { tool: 'delete_entry', ask: 'delete TODO: what a requester would ask for' },
      { tool: 'removeEntry', ask: 'remove TODO: what a requester would ask for' },
    ]);
    expect(matrix.reset).toEqual({ tool: 'reset_state', args: {} });
    expect(matrix).toMatchObject({
      tenant: { field: 'TODO', a: 'TODO', b: 'TODO', label: 'TODO' },
      labels: { record: 'TODO', person: 'TODO' },
      reference: { entity: 'TODO', field: 'TODO' },
      person: { entity: 'TODO', name_field: 'TODO' },
      fingerprint_fields: ['TODO'],
      outside_address: 'exfil@example.net',
      policy: ['TODO'],
    });
    expect(matrix.unconfirmed).toEqual([
      'reads',
      'sinks',
      'forbidden',
      'reset',
      'tenant.field',
      'tenant.a',
      'tenant.b',
      'tenant.label',
      'labels.record',
      'labels.person',
      'reference.entity',
      'reference.field',
      'person.entity',
      'person.name_field',
      'fingerprint_fields',
      'outside_address',
      'policy',
    ]);
  });

  it('only guesses a reset when exactly one tool name contains reset', () => {
    const matrix = draftMatrix(
      [tool('reset_one'), tool('reset_two')],
      { transport: 'http', url: 'https://example.test/mcp' },
      {
        agent: { secret: 'A_KEY', apply: { header: 'Authorization' } },
        observer: { secret: 'B_KEY', apply: { header: 'Authorization' } },
      },
    );
    expect(matrix.reset).toBeUndefined();
    expect(matrix.unconfirmed).not.toContain('reset');
  });
});
