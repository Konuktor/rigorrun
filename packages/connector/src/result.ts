/**
 * One reading of what a call handed back, for every part of the product.
 *
 * Six different places used to interpret a `CallResult` — the read probe at
 * setup, demonstration capture, the compile inputs, the runtime state read,
 * the action result handed to an agent, and the tests — and no two of them
 * agreed on what counted as records. The probe accepted JSON encoded inside a
 * text block; the capture path read `structured` only. A server that answers
 * every tool with `content:[{type:'text', text:'{…}'}]` and no
 * `structuredContent` — the most common MCP shape there is — passed the probe
 * and then produced an empty schema after a person had already done the job.
 *
 * So there is one normaliser, at the lowest package that owns `CallResult`,
 * and every interpreter goes through it. The rules are narrow on purpose:
 *
 * - `structured` (MCP `structuredContent`, a parsed HTTP body) always wins.
 * - Text blocks are parsed as JSON only when the *whole* block is JSON with an
 *   object or array at the top level. `"ok"`, `42`, or a sentence that happens
 *   to contain braces are prose, and prose is never reinterpreted as state.
 * - A result with any non-JSON text block is `text`, whatever else it holds.
 * - No content at all is `empty`, which is a different fact from prose: an
 *   empty system has nothing to say yet; a prose system can never be read.
 * - An error is `error`, and carries no payload — a failed read is missing
 *   evidence, not an empty world.
 */
import type { CallResult } from './types.ts';

export type NormalizedResultKind = 'structured' | 'json_text' | 'text' | 'empty' | 'error';

export interface NormalizedResult {
  kind: NormalizedResultKind;
  /** Present for `structured` and `json_text` only. Already canonicalised. */
  payload?: unknown;
  /** The concatenated text blocks, for a message or a log. Never state. */
  text?: string;
  error?: { code: string; message: string };
}

interface ContentBlockLike {
  type?: unknown;
  text?: unknown;
  resource?: { text?: unknown; mimeType?: unknown };
}

/** Whether a normalised result holds something that can be read as records. */
export function hasPayload(result: NormalizedResult): result is NormalizedResult & { payload: unknown } {
  return result.kind === 'structured' || result.kind === 'json_text';
}

export function normalizeCallResult(result: CallResult): NormalizedResult {
  if (!result.ok) {
    const text = textOf(result.content);
    return {
      kind: 'error',
      error: result.error ?? { code: 'CALL_FAILED', message: 'the call failed' },
      ...(text !== undefined ? { text } : {}),
    };
  }
  if (result.structured !== undefined && result.structured !== null) {
    return { kind: 'structured', payload: canonicalisePayload(result.structured) };
  }
  return normalizeContent(result.content);
}

/**
 * The same reading for a raw MCP `CallToolResult`, so a test or a fixture that
 * talks to a server directly cannot drift from the product path.
 */
export function normalizeToolResult(raw: {
  content?: unknown;
  structuredContent?: unknown;
  isError?: boolean;
}): NormalizedResult {
  return normalizeCallResult({
    ok: raw.isError !== true,
    content: raw.content,
    structured: raw.structuredContent,
    durationMs: 0,
    ...(raw.isError === true ? { error: { code: 'TOOL_ERROR', message: textOf(raw.content) ?? 'tool error' } } : {}),
  });
}

function normalizeContent(content: unknown): NormalizedResult {
  // An OpenAPI connector stores the raw body string here; a browser stores
  // nothing. Neither is a content array, and both are handled by the same
  // text rule so that one connector's prose is not another's records.
  if (typeof content === 'string') return fromTexts([content]);
  if (content === undefined || content === null) return { kind: 'empty' };
  if (!Array.isArray(content)) {
    // Something already object-shaped that is not an MCP content array: an
    // adapter that put a record here directly. Read it as structured data.
    return typeof content === 'object' ? { kind: 'structured', payload: canonicalisePayload(content) } : { kind: 'empty' };
  }
  const texts: string[] = [];
  for (const block of content as ContentBlockLike[]) {
    if (!block || typeof block !== 'object') continue;
    if (block.type === 'text' && typeof block.text === 'string') {
      texts.push(block.text);
      continue;
    }
    if (block.type === 'resource' && block.resource && typeof block.resource.text === 'string') {
      // An embedded resource is data only when the server says it is.
      const mime = typeof block.resource.mimeType === 'string' ? block.resource.mimeType : '';
      if (/json/i.test(mime)) texts.push(block.resource.text);
    }
    // Images, audio and binary resources carry no records.
  }
  return fromTexts(texts);
}

function fromTexts(texts: string[]): NormalizedResult {
  const meaningful = texts.map((t) => t.trim()).filter((t) => t.length > 0);
  if (meaningful.length === 0) return { kind: 'empty' };
  const parsed: unknown[] = [];
  for (const text of meaningful) {
    const value = parseJsonData(text);
    if (value === undefined) return { kind: 'text', text: meaningful.join('\n') };
    parsed.push(value);
  }
  return {
    kind: 'json_text',
    payload: canonicalisePayload(parsed.length === 1 ? parsed[0] : parsed),
    text: meaningful.join('\n'),
  };
}

/** JSON with an object or array at the top level, or nothing. */
function parseJsonData(text: string): unknown {
  const first = text[0];
  if (first !== '{' && first !== '[') return undefined;
  try {
    const value: unknown = JSON.parse(text);
    return typeof value === 'object' && value !== null ? value : undefined;
  } catch {
    return undefined;
  }
}

function textOf(content: unknown): string | undefined {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return undefined;
  const texts = (content as ContentBlockLike[])
    .filter((block) => block && typeof block === 'object' && block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text as string);
  return texts.length > 0 ? texts.join('\n') : undefined;
}

// ------------------------------------------------------------ canonical shape

const TAG_KEYS = new Set(['kind', 'type']);
const MAX_DEPTH = 8;

/**
 * Structural rewrites applied before any payload is read for records, so that
 * induction and row extraction see exactly the same shape.
 *
 * 1. Tagged scalars. `{kind: "Integer", value: 1}` is one value with its type
 *    written next to it — the shape typed cells, serde enums and several
 *    database bridges use. Read as a record it becomes a two-field entity keyed
 *    by its own value, which is how a table of rows turned into an `Id` entity
 *    in the audit. Only the exact two-key shape with a string tag and a scalar
 *    (or null) value is unwrapped; a third field means it is a record.
 * 2. Uniform wrappers in lists. `rows: [{columns: {…}}, {columns: {…}}]` is a
 *    list of records each wrapped in a single role-named key. When every entry
 *    of a list is a single-key object around an object, the wrapper is dropped
 *    so the list's own name — the collection — names the record.
 *
 * Nothing here looks at what a key means. `kind`/`type` are the two words the
 * tagged-scalar convention itself uses, and the rule still requires the shape.
 */
export function canonicalisePayload(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    const entries = value.map((entry) => canonicalisePayload(entry, depth + 1));
    return isUniformWrapperList(entries)
      ? entries.map((entry) => Object.values(entry as Record<string, unknown>)[0])
      : entries;
  }
  const object = value as Record<string, unknown>;
  const tagged = taggedScalar(object);
  if (tagged !== NOT_TAGGED) return tagged;
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(object)) out[key] = canonicalisePayload(entry, depth + 1);
  return out;
}

const NOT_TAGGED = Symbol('not-tagged');

function taggedScalar(object: Record<string, unknown>): unknown {
  const keys = Object.keys(object);
  if (keys.length !== 2 || !keys.includes('value')) return NOT_TAGGED;
  const tag = keys.find((key) => key !== 'value')!;
  if (!TAG_KEYS.has(tag) || typeof object[tag] !== 'string') return NOT_TAGGED;
  const inner = object['value'];
  if (inner !== null && typeof inner === 'object') return NOT_TAGGED;
  return inner;
}

function isUniformWrapperList(entries: unknown[]): boolean {
  if (entries.length === 0) return false;
  let wrapper: string | undefined;
  for (const entry of entries) {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) return false;
    const keys = Object.keys(entry as object);
    if (keys.length !== 1) return false;
    const inner = (entry as Record<string, unknown>)[keys[0]!];
    if (inner === null || typeof inner !== 'object' || Array.isArray(inner)) return false;
    if (wrapper === undefined) wrapper = keys[0];
    else if (wrapper !== keys[0]) return false;
  }
  return true;
}
