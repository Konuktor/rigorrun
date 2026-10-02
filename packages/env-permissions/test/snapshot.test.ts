import { describe, expect, it } from 'vitest';
import { snapshot, type ToolCaller } from '../src/snapshot.ts';

describe('snapshot', () => {
  it('reads records reached through another, and gives them their parent owner', async () => {
    const call: ToolCaller = async (tool, args) => {
      if (tool === 'list_people') {
        return {
          items: [
            { id: 'p1', tenant: 'x' },
            { id: 'p2', tenant: 'y' },
          ],
        };
      }
      if (tool === 'list_bookings') {
        return { items: [{ id: `b-${String(args['person'])}`, when: '09:00' }] };
      }
      throw new Error(tool);
    };
    const rows = await snapshot(
      call,
      [
        { tool: 'list_people', args: {}, rows: 'items', entity: 'people' },
        {
          tool: 'list_bookings',
          args: {},
          rows: 'items',
          entity: 'bookings',
          for_each: { entity: 'people', arg: 'person', field: 'id' },
        },
      ],
      'tenant',
    );
    expect(rows.filter((r) => r.entity === 'bookings').map((r) => [r.rowId, r.owner])).toEqual([
      ['b-p1', 'x'],
      ['b-p2', 'y'],
    ]);
  });
});
