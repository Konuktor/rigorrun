import { describe, expect, it } from 'vitest';
import { validateSchema } from '@rigorrun/environment';
import { helpdeskSchema } from '../src/index.ts';

describe('the Larch Helpdesk schema', () => {
  it('is valid and includes an organisation on every row', () => {
    expect(validateSchema(helpdeskSchema)).toEqual([]);
    for (const entity of helpdeskSchema.entities) {
      expect(
        entity.fields.some((field) => field.name === 'org_id'),
        entity.name,
      ).toBe(true);
    }
  });

  it('marks only the specified customer-authored and outbound prose as untrusted', () => {
    const untrusted = helpdeskSchema.entities.flatMap((entity) =>
      entity.fields
        .filter((field) => field.untrusted)
        .map((field) => `${entity.name}.${field.name}`),
    );
    expect(untrusted).toEqual(['Customer.notes', 'Ticket.body', 'Outbox.body']);
  });
});
