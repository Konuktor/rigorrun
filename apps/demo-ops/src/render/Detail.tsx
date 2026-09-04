/**
 * One record, and the things you can do to it.
 *
 * Sections come from the environment's declaration; so does the order of the
 * actions offered. The renderer's only contribution is deciding that a `prose`
 * section is wide and a `facts` section is a definition list.
 */
import { useState } from 'react';
import {
  entityByName,
  relationshipsFrom,
  type CanonicalState,
  type EntityPresentation,
  type EntityRow,
  type EnvironmentAdapter,
  type EnvironmentSchema,
  type PresentationHints,
} from '@rigorrun/environment';
import { Value, labelFor, resolveValue, titleOf } from './values.tsx';
import { ActionForm } from './ActionForm.tsx';
import { perform } from '../store.ts';
import { hrefFor } from '../router.ts';

interface Props {
  adapter: EnvironmentAdapter;
  schema: EnvironmentSchema;
  hints: PresentationHints;
  presentation: EntityPresentation;
  state: CanonicalState;
  environmentId: string;
  row: EntityRow;
}

export function Detail({
  adapter,
  schema,
  hints,
  presentation,
  state,
  environmentId,
  row,
}: Props) {
  const [openAction, setOpenAction] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; message: string } | null>(null);

  const entity = entityByName(schema, presentation.entity);
  const lookup = (name: string, id: unknown) =>
    id === undefined || id === null ? undefined : state.entities[name]?.[String(id)];
  const emphasis = presentation.columns.find((column) => column.emphasis)?.field;
  if (!entity) return null;

  const subtitleRaw = presentation.subtitleField
    ? resolveValue(schema, presentation.entity, row, presentation.subtitleField, lookup).value
    : undefined;
  const title = titleOf(schema, presentation.entity, row, emphasis, lookup);
  const subtitle =
    subtitleRaw === undefined || subtitleRaw === null || String(subtitleRaw) === title
      ? null
      : String(subtitleRaw);

  const actions = (presentation.actions ?? [])
    .map((name) => adapter.getActions().find((action) => action.name === name))
    .filter((action): action is NonNullable<typeof action> => action !== undefined);

  /**
   * What the form already knows: this record's id under whichever parameter
   * refers to it, plus any link it already holds.
   */
  const prefillFor = (actionName: string): Record<string, unknown> => {
    const action = adapter.getActions().find((candidate) => candidate.name === actionName);
    const prefill: Record<string, unknown> = {};
    for (const param of action?.params ?? []) {
      if (!param.entityRef) continue;
      if (param.entityRef === presentation.entity) {
        prefill[param.name] = row[entity.idField];
        continue;
      }
      const relationship = relationshipsFrom(schema, presentation.entity).find(
        (candidate) => candidate.via.kind === 'fk' && candidate.to === param.entityRef,
      );
      const key = relationship?.via.kind === 'fk' ? relationship.via.field : undefined;
      if (key && row[key] !== undefined && row[key] !== null) prefill[param.name] = row[key];
    }
    return prefill;
  };

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <a
            href={hrefFor(environmentId, presentation.entity)}
            className="text-[12.5px] text-ink-faint hover:text-ink"
          >
            ← {presentation.plural}
          </a>
          <h1 className="mt-1 text-[22px] font-semibold tracking-tight">
            {titleOf(schema, presentation.entity, row, emphasis, lookup)}
          </h1>
          <p className="mt-0.5 flex flex-wrap items-center gap-2 text-[12.5px] text-ink-faint">
            <span className="font-mono">{String(row[entity.idField])}</span>
            {subtitle ? <span>{subtitle}</span> : null}
          </p>
        </div>
        {actions.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {actions.map((action) => (
              <button
                key={action.name}
                type="button"
                data-testid={`action-${action.name}`}
                onClick={() => {
                  setNotice(null);
                  setOpenAction((current) => (current === action.name ? null : action.name));
                }}
                className={`inline-flex h-9 items-center rounded-md px-3 text-[13.5px] font-medium ${
                  openAction === action.name
                    ? 'bg-brand text-white'
                    : 'border border-rule bg-surface hover:border-brand'
                }`}
              >
                {hints.actionLabels?.[action.name] ?? action.description.replace(/\.$/, '')}
              </button>
            ))}
          </div>
        ) : null}
      </header>

      {notice ? (
        <p
          data-testid="action-notice"
          className={`rounded-md px-3 py-2 text-[13px] ${
            notice.ok
              ? 'bg-emerald-50 text-emerald-900 ring-1 ring-inset ring-emerald-200'
              : 'bg-rose-50 text-rose-900 ring-1 ring-inset ring-rose-200'
          }`}
        >
          {notice.message}
        </p>
      ) : null}

      {openAction
        ? (() => {
            const action = adapter.getActions().find((candidate) => candidate.name === openAction);
            if (!action) return null;
            return (
              <ActionForm
                action={action}
                schema={schema}
                state={state}
                label={hints.actionLabels?.[action.name] ?? action.description.replace(/\.$/, '')}
                prefill={prefillFor(openAction)}
                busy={busy}
                onCancel={() => setOpenAction(null)}
                onSubmit={(args) => {
                  setBusy(true);
                  void perform(environmentId, action.name, args).then((result) => {
                    setBusy(false);
                    setNotice({ ok: result.ok, message: result.message });
                    if (result.ok) setOpenAction(null);
                  });
                }}
              />
            );
          })()
        : null}

      <div className="grid gap-3 md:grid-cols-2">
        {presentation.sections.map((section) => (
          <section
            key={section.title}
            className={`rounded-lg border border-rule bg-surface ${
              section.kind === 'prose' ? 'md:col-span-2' : ''
            }`}
          >
            <h2 className="border-b border-rule px-4 py-2.5 text-[12px] font-semibold uppercase tracking-wide text-ink-faint">
              {section.title}
            </h2>
            {section.kind === 'prose' ? (
              <div className="px-4 py-3 text-[13.5px] leading-relaxed">
                {section.fields.map((path) => {
                  const { value } = resolveValue(schema, presentation.entity, row, path, lookup);
                  return (
                    <p key={path} data-testid={`prose-${path}`} className="whitespace-pre-wrap">
                      {value === null || value === undefined || value === '' ? (
                        <span className="text-ink-faint">Nothing recorded.</span>
                      ) : (
                        String(value)
                      )}
                    </p>
                  );
                })}
              </div>
            ) : (
              <dl className="divide-y divide-rule">
                {section.fields.map((path) => {
                  const { value, field } = resolveValue(
                    schema,
                    presentation.entity,
                    row,
                    path,
                    lookup,
                  );
                  return (
                    <div key={path} className="flex items-center justify-between gap-3 px-4 py-2">
                      <dt className="text-[12.5px] text-ink-faint">
                        {labelFor(schema, presentation.entity, path)}
                      </dt>
                      <dd data-testid={`field-${path}`} className="text-right text-[13.5px]">
                        <Value value={value} field={field} hints={hints} />
                      </dd>
                    </div>
                  );
                })}
              </dl>
            )}
          </section>
        ))}
      </div>
    </div>
  );
}
