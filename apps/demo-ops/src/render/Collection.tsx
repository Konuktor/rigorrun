/**
 * A collection of records, drawn the way the environment declared.
 *
 * `view: 'table'` gets a table, `view: 'board'` gets columns grouped by a
 * declared status field, `view: 'list'` gets a plain list. The renderer reads
 * the declaration; it does not know that a sales pipeline is usually a board
 * and an invoice queue usually is not.
 */
import {
  entityByName,
  rowsOf,
  type CanonicalState,
  type EntityPresentation,
  type EntityRow,
  type EnvironmentSchema,
  type PresentationHints,
} from '@rigorrun/environment';
import { Value, labelFor, resolveValue, titleOf } from './values.tsx';
import { hrefFor } from '../router.ts';

interface Props {
  schema: EnvironmentSchema;
  hints: PresentationHints;
  presentation: EntityPresentation;
  state: CanonicalState;
  environmentId: string;
}

const WIDTH: Record<string, string> = {
  narrow: 'w-28',
  normal: '',
  wide: 'w-[16rem]',
};

export function Collection({ schema, hints, presentation, state, environmentId }: Props) {
  const rows = rowsOf(state, presentation.entity);
  const entity = entityByName(schema, presentation.entity);
  const lookup = (name: string, id: unknown) =>
    id === undefined || id === null ? undefined : state.entities[name]?.[String(id)];
  const emphasis = presentation.columns.find((column) => column.emphasis)?.field;

  if (!entity) return null;

  if (rows.length === 0) {
    return (
      <p className="rounded-lg border border-rule bg-surface px-4 py-8 text-center text-ink-faint">
        Nothing here yet.
      </p>
    );
  }

  if (presentation.view === 'board' && presentation.groupBy) {
    const field = entity.fields.find((candidate) => candidate.name === presentation.groupBy);
    const columns = field?.enumValues ?? [];
    return (
      <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${columns.length}, minmax(13rem, 1fr))` }}>
        {columns.map((column) => {
          const inColumn = rows.filter((row) => String(row[presentation.groupBy!]) === column);
          return (
            <section key={column} className="min-w-0">
              <h3 className="mb-2 flex items-center gap-2 text-[12px] font-semibold uppercase tracking-wide text-ink-faint">
                {column.replace(/_/g, ' ')}
                <span className="rounded-full bg-canvas px-1.5 tabular-nums">{inColumn.length}</span>
              </h3>
              <div className="space-y-2">
                {inColumn.map((row) => (
                  <a
                    key={String(row[entity.idField])}
                    href={hrefFor(environmentId, presentation.entity, String(row[entity.idField]))}
                    data-testid={`card-${String(row[entity.idField])}`}
                    className="block rounded-lg border border-rule bg-surface p-3 hover:border-brand"
                  >
                    <div className="truncate font-medium">
                      {titleOf(schema, presentation.entity, row, emphasis, lookup)}
                    </div>
                    <dl className="mt-2 space-y-1">
                      {presentation.columns
                        .filter((column2) => !column2.emphasis)
                        .map((column2) => {
                          const { value, field: fieldSchema } = resolveValue(
                            schema,
                            presentation.entity,
                            row,
                            column2.field,
                            lookup,
                          );
                          return (
                            <div key={column2.field} className="flex items-center justify-between gap-2">
                              <dt className="truncate text-[12px] text-ink-faint">
                                {labelFor(schema, presentation.entity, column2.field, column2.label)}
                              </dt>
                              <dd className="shrink-0 text-[12.5px]">
                                <Value value={value} field={fieldSchema} hints={hints} />
                              </dd>
                            </div>
                          );
                        })}
                    </dl>
                  </a>
                ))}
              </div>
            </section>
          );
        })}
      </div>
    );
  }

  if (presentation.view === 'list') {
    return (
      <ul className="divide-y divide-rule overflow-hidden rounded-lg border border-rule bg-surface">
        {rows.map((row) => (
          <li key={String(row[entity.idField])}>
            <a
              href={hrefFor(environmentId, presentation.entity, String(row[entity.idField]))}
              data-testid={`row-${String(row[entity.idField])}`}
              className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 hover:bg-brand-soft"
            >
              <span className="font-medium">
                {titleOf(schema, presentation.entity, row, emphasis, lookup)}
              </span>
              <span className="flex items-center gap-3">
                {presentation.columns
                  .filter((column) => !column.emphasis)
                  .map((column) => {
                    const { value, field } = resolveValue(
                      schema,
                      presentation.entity,
                      row,
                      column.field,
                      lookup,
                    );
                    return (
                      <Value key={column.field} value={value} field={field} hints={hints} />
                    );
                  })}
              </span>
            </a>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-rule bg-surface">
      <table className="w-full text-left">
        <thead>
          <tr className="border-b border-rule text-[12px] uppercase tracking-wide text-ink-faint">
            {presentation.columns.map((column) => (
              <th
                key={column.field}
                scope="col"
                className={`cell font-medium ${WIDTH[column.width ?? 'normal'] ?? ''} ${
                  column.align === 'end' ? 'text-right' : ''
                }`}
              >
                {labelFor(schema, presentation.entity, column.field, column.label)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-rule">
          {rows.map((row) => (
            <tr
              key={String(row[entity.idField])}
              className="hover:bg-brand-soft"
              data-testid={`row-${String(row[entity.idField])}`}
            >
              {presentation.columns.map((column, index) => {
                const { value, field } = resolveValue(
                  schema,
                  presentation.entity,
                  row,
                  column.field,
                  lookup,
                );
                return (
                  <td
                    key={column.field}
                    className={`cell ${column.align === 'end' ? 'text-right' : ''}`}
                  >
                    {index === 0 ? (
                      <a
                        href={hrefFor(
                          environmentId,
                          presentation.entity,
                          String(row[entity.idField]),
                        )}
                        className="font-medium text-brand hover:underline"
                      >
                        {titleOf(schema, presentation.entity, row, emphasis, lookup)}
                      </a>
                    ) : (
                      <Value value={value} field={field} hints={hints} />
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export type { EntityRow };
