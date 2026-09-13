/**
 * One reading of a tool result, for every interpreter in the product.
 *
 * The audit found the setup probe accepting JSON inside a text block while
 * demonstration capture did not, so a server that answers only that way passed
 * setup and produced an empty schema after the job had been done. This corpus
 * pins what counts as records and — just as important — what never does.
 */
import { describe, expect, it } from 'vitest';
import { canonicalisePayload, hasPayload, normalizeCallResult, normalizeToolResult } from '../src/index.ts';

const ok = (partial: { content?: unknown; structured?: unknown }) => ({ ok: true, durationMs: 1, ...partial });

describe('normalizeCallResult — what is state and what is not', () => {
  it('reads structuredContent as records', () => {
    const result = normalizeCallResult(ok({ structured: { rows: [{ id: 1, title: 'a' }] }, content: [{ type: 'text', text: 'ignored' }] }));
    expect(result.kind).toBe('structured');
    expect(result.payload).toEqual({ rows: [{ id: 1, title: 'a' }] });
  });

  it('reads a JSON object inside a single text block as records', () => {
    const result = normalizeCallResult(ok({ content: [{ type: 'text', text: '{\n  "running": false\n}' }] }));
    expect(result.kind).toBe('json_text');
    expect(result.payload).toEqual({ running: false });
  });

  it('reads a JSON array inside a text block as records', () => {
    const result = normalizeCallResult(ok({ content: [{ type: 'text', text: '[{"id":"t1","name":"x"},{"id":"t2","name":"y"}]' }] }));
    expect(hasPayload(result)).toBe(true);
    expect(result.payload).toEqual([{ id: 't1', name: 'x' }, { id: 't2', name: 'y' }]);
  });

  it('never offers the content-block array itself as records', () => {
    // `{type:'text', text:'…'}` has two scalar fields and would induce as a
    // record. That is exactly how the probe was fooled.
    const result = normalizeCallResult(ok({ content: [{ type: 'text', text: 'Found 3 files' }] }));
    expect(result.kind).toBe('text');
    expect(result.payload).toBeUndefined();
    expect(result.text).toBe('Found 3 files');
  });

  it('treats valid non-JSON text as prose, never as state', () => {
    for (const text of ['[FILE] q3-plan.md', 'OK', 'Booking BKG-1 confirmed {yes}', '{not json', '[1, 2', '']) {
      const result = normalizeCallResult(ok({ content: [{ type: 'text', text }] }));
      expect(hasPayload(result)).toBe(false);
      expect(['text', 'empty']).toContain(result.kind);
    }
  });

  it('treats malformed JSON text as prose', () => {
    const result = normalizeCallResult(ok({ content: [{ type: 'text', text: '{"a": 1,}' }] }));
    expect(result.kind).toBe('text');
  });

  it('does not reinterpret a bare JSON scalar as state', () => {
    for (const text of ['"ok"', '42', 'true', 'null']) {
      expect(normalizeCallResult(ok({ content: [{ type: 'text', text }] })).kind).toBe('text');
    }
  });

  it('calls empty content empty, not prose', () => {
    expect(normalizeCallResult(ok({ content: [] })).kind).toBe('empty');
    expect(normalizeCallResult(ok({})).kind).toBe('empty');
    expect(normalizeCallResult(ok({ content: [{ type: 'text', text: '   ' }] })).kind).toBe('empty');
  });

  it('collects several JSON text blocks into one list', () => {
    const result = normalizeCallResult(
      ok({ content: [{ type: 'text', text: '{"id":1}' }, { type: 'image', data: 'AAA', mimeType: 'image/png' }, { type: 'text', text: '{"id":2}' }] }),
    );
    expect(result.kind).toBe('json_text');
    expect(result.payload).toEqual([{ id: 1 }, { id: 2 }]);
  });

  it('is prose when any text block is prose, even beside JSON', () => {
    const result = normalizeCallResult(ok({ content: [{ type: 'text', text: '{"id":1}' }, { type: 'text', text: 'and that is all' }] }));
    expect(result.kind).toBe('text');
  });

  it('reads an embedded JSON resource, and ignores other resources', () => {
    const json = normalizeCallResult(ok({ content: [{ type: 'resource', resource: { uri: 'x', mimeType: 'application/json', text: '{"a":1}' } }] }));
    expect(json.payload).toEqual({ a: 1 });
    const html = normalizeCallResult(ok({ content: [{ type: 'resource', resource: { uri: 'x', mimeType: 'text/html', text: '<p>{"a":1}</p>' } }] }));
    expect(html.kind).toBe('empty');
  });

  it('carries an MCP error as missing evidence, never as an empty world', () => {
    const result = normalizeCallResult({ ok: false, error: { code: 'call_failed', message: 'denied' }, content: [{ type: 'text', text: 'access denied' }], durationMs: 1 });
    expect(result.kind).toBe('error');
    expect(result.payload).toBeUndefined();
    expect(result.error?.message).toBe('denied');
    expect(result.text).toBe('access denied');
  });

  it('reads a raw CallToolResult the same way', () => {
    expect(normalizeToolResult({ content: [{ type: 'text', text: '{"a":1}' }] }).payload).toEqual({ a: 1 });
    expect(normalizeToolResult({ content: [{ type: 'text', text: 'boom' }], isError: true }).kind).toBe('error');
    expect(normalizeToolResult({ content: [], structuredContent: { a: 1 } }).kind).toBe('structured');
  });

  it('reads an OpenAPI-style string body by the same text rule', () => {
    expect(normalizeCallResult(ok({ content: '{"items":[]}' })).payload).toEqual({ items: [] });
    expect(normalizeCallResult(ok({ content: 'Created.' })).kind).toBe('text');
  });
});

describe('canonicalisePayload — one shape before anything is read', () => {
  it('unwraps tagged scalars to their values', () => {
    expect(canonicalisePayload({ kind: 'Integer', value: 1 })).toBe(1);
    expect(canonicalisePayload({ type: 'Text', value: 'ada' })).toBe('ada');
    expect(canonicalisePayload({ kind: 'Null', value: null })).toBeNull();
  });

  it('leaves a record that merely has kind and value fields alone', () => {
    expect(canonicalisePayload({ kind: 'Integer', value: 1, unit: 'cm' })).toEqual({ kind: 'Integer', value: 1, unit: 'cm' });
    expect(canonicalisePayload({ kind: 'Row', value: { id: 1 } })).toEqual({ kind: 'Row', value: { id: 1 } });
    expect(canonicalisePayload({ kind: 3, value: 1 })).toEqual({ kind: 3, value: 1 });
    expect(canonicalisePayload({ label: 'x', value: 1 })).toEqual({ label: 'x', value: 1 });
  });

  it('turns a table of tagged cells into rows', () => {
    const table = {
      rows: [
        { columns: { id: { kind: 'Integer', value: 1 }, title: { kind: 'Text', value: 'Prepare invoice' }, amount: { kind: 'Real', value: 120.5 } } },
        { columns: { id: { kind: 'Integer', value: 2 }, title: { kind: 'Text', value: 'Review contract' }, amount: { kind: 'Real', value: 80 } } },
      ],
      rows_changed: 0,
    };
    expect(canonicalisePayload(table)).toEqual({
      rows: [
        { id: 1, title: 'Prepare invoice', amount: 120.5 },
        { id: 2, title: 'Review contract', amount: 80 },
      ],
      rows_changed: 0,
    });
  });

  it('drops a uniform single-key wrapper only when every entry wears it', () => {
    expect(canonicalisePayload([{ item: { id: 1 } }, { item: { id: 2 } }])).toEqual([{ id: 1 }, { id: 2 }]);
    expect(canonicalisePayload([{ item: { id: 1 } }, { other: { id: 2 } }])).toEqual([{ item: { id: 1 } }, { other: { id: 2 } }]);
    expect(canonicalisePayload([{ item: { id: 1 } }, { id: 2 }])).toEqual([{ item: { id: 1 } }, { id: 2 }]);
    expect(canonicalisePayload([{ id: 1 }, { id: 2 }])).toEqual([{ id: 1 }, { id: 2 }]);
  });

  it('is idempotent', () => {
    const once = canonicalisePayload({ rows: [{ columns: { id: { kind: 'Integer', value: 1 }, note: { kind: 'Text', value: 'x' } } }] });
    expect(canonicalisePayload(once)).toEqual(once);
  });
});
