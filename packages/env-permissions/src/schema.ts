/**
 * The one schema every server is read into. A server's own tables are not
 * known in advance, so each row RigorRun reads is kept as a `Row` — which
 * entity it came from, its id, whose it is (the matrix's tenant field), and a
 * digest of its whole content, so a change anywhere in it shows — and each row
 * of the server's audit log, when the matrix names one, as an `Audit`.
 */
import type { EnvironmentSchema, FieldSchema } from '@rigorrun/environment';

function text(name: string, label: string, role?: FieldSchema['role']): FieldSchema {
  return { name, type: 'string', nullable: true, ...(role ? { role } : {}), label };
}

export const permissionsSchema: EnvironmentSchema = {
  entities: [
    {
      name: 'Row',
      idField: 'id',
      label: 'Record',
      mutable: true,
      appendOnly: false,
      fields: [
        { name: 'id', type: 'string', nullable: false, role: 'identifier', label: 'Key' },
        text('entity', 'Kind'),
        text('row_id', 'Record id'),
        text('owner', 'Owner'),
        text('digest', 'Content digest'),
        { ...text('content', 'Content', 'freetext'), untrusted: true },
      ],
    },
    {
      name: 'Audit',
      idField: 'id',
      label: 'Audit entry',
      mutable: false,
      appendOnly: true,
      fields: [
        { name: 'id', type: 'string', nullable: false, role: 'identifier', label: 'Entry' },
        text('actor', 'Actor'),
        text('owner', 'Owner of the record touched'),
        text('detail', 'Detail', 'freetext'),
      ],
    },
  ],
  relationships: [],
};
