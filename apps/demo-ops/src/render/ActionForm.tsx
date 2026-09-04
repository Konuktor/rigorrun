/**
 * A form generated from an action's parameter schema.
 *
 * An `entityRef` parameter becomes a picker over the records that exist; an
 * enum becomes a select over its declared values; a number becomes a number
 * field. Nothing here knows what any particular action does, which is why the
 * same component offers "approve invoice", "qualify lead", "grant access" and
 * "dispatch shipment".
 */
import { useMemo, useState } from 'react';
import {
  entityByName,
  rowsOf,
  type ActionDefinition,
  type CanonicalState,
  type EnvironmentSchema,
} from '@rigorrun/environment';
import { humanise } from './values.tsx';

interface Props {
  action: ActionDefinition;
  /** Short button text, declared by the environment. */
  label: string;
  schema: EnvironmentSchema;
  state: CanonicalState;
  /** Values already known from the record the form was opened on. */
  prefill: Record<string, unknown>;
  busy: boolean;
  onSubmit: (args: Record<string, unknown>) => void;
  onCancel: () => void;
}

export function ActionForm({
  action,
  label,
  schema,
  state,
  prefill,
  busy,
  onSubmit,
  onCancel,
}: Props) {
  const initial = useMemo(() => {
    const values: Record<string, string> = {};
    for (const param of action.params) {
      const supplied = prefill[param.name];
      if (supplied !== undefined && supplied !== null) values[param.name] = String(supplied);
      else if (param.type === 'enum') values[param.name] = param.enumValues?.[0] ?? '';
      else values[param.name] = '';
    }
    return values;
  }, [action, prefill]);

  const [values, setValues] = useState(initial);
  const set = (name: string, value: string) =>
    setValues((previous) => ({ ...previous, [name]: value }));

  const missing = action.params.filter(
    (param) => param.required && (values[param.name] ?? '').trim() === '',
  );

  return (
    <form
      className="space-y-3 rounded-lg border border-rule bg-surface p-4"
      data-testid={`action-form-${action.name}`}
      onSubmit={(event) => {
        event.preventDefault();
        const args: Record<string, unknown> = {};
        for (const param of action.params) {
          const raw = (values[param.name] ?? '').trim();
          if (raw === '') continue;
          args[param.name] = param.type === 'number' ? Number(raw) : raw;
        }
        onSubmit(args);
      }}
    >
      <div>
        <h3 className="font-semibold">{label}</h3>
        <p className="mt-0.5 text-[12.5px] text-ink-faint">
          {action.params.length} field{action.params.length === 1 ? '' : 's'}
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {action.params.map((param) => {
          const id = `${action.name}-${param.name}`;
          const fieldLabel = param.description || humanise(param.name);
          const common =
            'mt-1 h-9 w-full rounded-md border border-rule bg-surface px-2 text-[13.5px]';

          if (param.entityRef) {
            const target = entityByName(schema, param.entityRef);
            const options = target ? rowsOf(state, param.entityRef) : [];
            return (
              <div key={param.name}>
                <label htmlFor={id} className="text-[12.5px] font-medium text-ink-soft">
                  {fieldLabel}
                  {param.required ? '' : ' (optional)'}
                </label>
                <select
                  id={id}
                  data-testid={`param-${param.name}`}
                  className={common}
                  value={values[param.name] ?? ''}
                  onChange={(event) => set(param.name, event.target.value)}
                >
                  <option value="">—</option>
                  {options.map((row) => {
                    const value = String(row[target!.idField]);
                    return (
                      <option key={value} value={value}>
                        {value}
                      </option>
                    );
                  })}
                </select>
              </div>
            );
          }

          if (param.type === 'enum') {
            return (
              <div key={param.name}>
                <label htmlFor={id} className="text-[12.5px] font-medium text-ink-soft">
                  {fieldLabel}
                </label>
                <select
                  id={id}
                  data-testid={`param-${param.name}`}
                  className={common}
                  value={values[param.name] ?? ''}
                  onChange={(event) => set(param.name, event.target.value)}
                >
                  {(param.enumValues ?? []).map((option) => (
                    <option key={option} value={option}>
                      {option.replace(/_/g, ' ')}
                    </option>
                  ))}
                </select>
              </div>
            );
          }

          return (
            <div key={param.name}>
              <label htmlFor={id} className="text-[12.5px] font-medium text-ink-soft">
                {fieldLabel}
                {param.required ? '' : ' (optional)'}
              </label>
              <input
                id={id}
                data-testid={`param-${param.name}`}
                className={common}
                // A number field on purpose: it is the environment that says
                // this parameter is a number, and a free-text box would let a
                // demo hide a class of failure the benchmark exists to catch.
                type={param.type === 'number' ? 'number' : 'text'}
                step={param.type === 'number' ? 'any' : undefined}
                value={values[param.name] ?? ''}
                onChange={(event) => set(param.name, event.target.value)}
              />
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="submit"
          data-testid={`submit-${action.name}`}
          disabled={busy || missing.length > 0}
          className="inline-flex h-9 items-center rounded-md bg-brand px-3 font-medium text-white disabled:opacity-40"
        >
          {label}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="inline-flex h-9 items-center rounded-md border border-rule px-3"
        >
          Cancel
        </button>
        {missing.length > 0 ? (
          <span className="text-[12.5px] text-ink-faint">
            Needs {missing.map((param) => humanise(param.name).toLowerCase()).join(', ')}.
          </span>
        ) : null}
      </div>
    </form>
  );
}
