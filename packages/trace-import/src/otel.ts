/**
 * Reading an OpenTelemetry trace of something that already happened.
 *
 * The point of this is the retention loop: an agent fails in production, and
 * that failure becomes a permanent case rather than a bug report somebody
 * closes. Everything before this made RigorRun useful *before* there is
 * traffic, which is the harder and more valuable half; this is the other one.
 *
 * Two rules shape the whole file.
 *
 * **No framework.** OpenTelemetry is what a great many agent runtimes already
 * emit, and the semantic conventions for GenAI are still moving, so this reads
 * what is stable — a span has a name, a start, a duration, a status and
 * attributes — and looks for tool calls in several conventions without
 * requiring any of them. A reader that only understands one framework's output
 * is a reader for people who already use that framework, which is not the
 * people who have a failure to explain.
 *
 * **Telemetry is not state.** A span saying `refund.amount = 500` is the
 * *agent's* record of what it sent, not the system's record of what happened.
 * Nothing here produces state, ever. What it produces is a description of what
 * an agent did, which becomes a case whose expected outcome is computed the
 * same way every generated case's is — by working out what the confirmed rules
 * require, not by believing the trace.
 */

/** One call an agent made, as far as a trace can say. */
export interface ImportedCall {
  tool: string;
  args: Record<string, unknown>;
  ok: boolean;
  error?: string;
  startedAt: number;
  durationMs: number;
  /** Which convention this was recognised by, so a person can check. */
  recognisedBy: string;
}

export interface ImportedTrace {
  /** The trace id, as the source called it. */
  traceId: string;
  /** The root span's name, which is usually the task. */
  name: string;
  startedAt: number;
  durationMs: number;
  calls: ImportedCall[];
  /** Spans that failed, whether or not they were tool calls. */
  failures: { name: string; message: string }[];
  /** Spans this reader did not recognise. Reported rather than dropped. */
  unrecognised: number;
  /** The model, when the trace says. Never inferred. */
  model: string;
}

interface RawSpan {
  traceId?: string;
  spanId?: string;
  parentSpanId?: string;
  name?: string;
  startTimeUnixNano?: string | number;
  endTimeUnixNano?: string | number;
  status?: { code?: number | string; message?: string };
  attributes?: unknown;
}

/** A trace beyond this is a data-export problem, not a failure to explain. */
const MAX_SPANS = 20_000;

export class TraceParseError extends Error {}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Flattens OTLP attributes, which are a list of typed key/value objects.
 *
 * Also accepts a plain object, because half the exporters in the world write
 * one and refusing them would be pedantry rather than rigour.
 */
function readAttributes(raw: unknown): Record<string, unknown> {
  if (isObject(raw)) return raw;
  if (!Array.isArray(raw)) return {};
  const out: Record<string, unknown> = {};
  for (const entry of raw) {
    if (!isObject(entry) || typeof entry['key'] !== 'string') continue;
    const value = entry['value'];
    if (!isObject(value)) {
      out[entry['key']] = value;
      continue;
    }
    // OTLP wraps every value in a type tag. Take whichever is present.
    for (const tag of ['stringValue', 'intValue', 'doubleValue', 'boolValue']) {
      if (value[tag] !== undefined) {
        out[entry['key']] = tag === 'intValue' ? Number(value[tag]) : value[tag];
        break;
      }
    }
    if (out[entry['key']] === undefined && isObject(value['kvlistValue'])) {
      out[entry['key']] = readAttributes((value['kvlistValue'] as { values?: unknown }).values);
    }
  }
  return out;
}

/** Every span in an OTLP document, whichever shape it arrived in. */
function collectSpans(document: unknown): RawSpan[] {
  const spans: RawSpan[] = [];
  const push = (value: unknown): void => {
    if (isObject(value) && (value['name'] !== undefined || value['spanId'] !== undefined)) {
      spans.push(value as RawSpan);
    }
  };

  if (Array.isArray(document)) {
    for (const entry of document) push(entry);
    return spans;
  }
  if (!isObject(document)) return spans;

  // The OTLP shape: resourceSpans → scopeSpans → spans.
  const resourceSpans = document['resourceSpans'] ?? document['resource_spans'];
  if (Array.isArray(resourceSpans)) {
    for (const resource of resourceSpans) {
      if (!isObject(resource)) continue;
      const scopes = resource['scopeSpans'] ?? resource['scope_spans'] ?? [];
      if (!Array.isArray(scopes)) continue;
      for (const scope of scopes) {
        if (!isObject(scope) || !Array.isArray(scope['spans'])) continue;
        for (const span of scope['spans']) push(span);
      }
    }
    return spans;
  }
  // A bare `{ spans: [...] }`, which several exporters write.
  if (Array.isArray(document['spans'])) {
    for (const span of document['spans']) push(span);
  }
  return spans;
}

function nanosToMs(value: string | number | undefined): number {
  if (value === undefined) return 0;
  const n = typeof value === 'string' ? Number(value) : value;
  return Number.isFinite(n) ? Math.round(n / 1e6) : 0;
}

/**
 * Whether a span is a tool call, and what it called.
 *
 * Deliberately several conventions and no requirement to match a particular
 * one. The GenAI semantic conventions are the newest and least settled thing in
 * OpenTelemetry, and an importer that insisted on today's spelling would stop
 * working on somebody's next upgrade.
 */
function asToolCall(span: RawSpan, attributes: Record<string, unknown>): ImportedCall | undefined {
  const name = span.name ?? '';
  const candidates: [string, string][] = [
    // The GenAI convention, as it currently stands.
    [String(attributes['gen_ai.tool.name'] ?? ''), 'gen_ai.tool.name'],
    // What several frameworks emit instead.
    [String(attributes['tool.name'] ?? ''), 'tool.name'],
    [String(attributes['mcp.tool.name'] ?? ''), 'mcp.tool.name'],
    [String(attributes['rpc.method'] ?? ''), 'rpc.method'],
    // And the oldest convention of all: the span is named after the tool.
    [
      /^(tool|execute_tool|tool\.execute)[ .:/-]/i.test(name)
        ? (name.split(/[ .:/-]/).pop() ?? '')
        : '',
      'span name',
    ],
  ];
  const found = candidates.find(([value]) => value.length > 0);
  if (!found) return undefined;

  const rawArgs =
    attributes['gen_ai.tool.call.arguments'] ??
    attributes['tool.arguments'] ??
    attributes['mcp.tool.arguments'] ??
    attributes['rpc.request.body'];
  let args: Record<string, unknown> = {};
  if (isObject(rawArgs)) args = rawArgs;
  else if (typeof rawArgs === 'string') {
    try {
      const parsed: unknown = JSON.parse(rawArgs);
      if (isObject(parsed)) args = parsed;
    } catch {
      // Not JSON. The call still counts; its arguments are simply unknown, and
      // saying so is better than inventing them.
    }
  }

  const code = span.status?.code;
  const ok =
    code === undefined || code === 0 || code === 1 || code === 'STATUS_CODE_OK' || code === 'OK';
  const started = nanosToMs(span.startTimeUnixNano);
  return {
    tool: found[0],
    args,
    ok,
    ...(span.status?.message ? { error: span.status.message } : {}),
    startedAt: started,
    durationMs: Math.max(0, nanosToMs(span.endTimeUnixNano) - started),
    recognisedBy: found[1],
  };
}

/**
 * Reads a trace, and says what it could not read.
 *
 * Never throws on an unrecognised span. A trace from a runtime this has never
 * seen should produce a partial answer and a count of what was skipped, so
 * somebody can look at it and decide — not an error that hides whatever was
 * recognisable.
 */
export function importOtelTrace(text: string): ImportedTrace {
  let document: unknown;
  try {
    document = JSON.parse(text);
  } catch (error) {
    throw new TraceParseError(
      `That is not readable JSON: ${(error as Error).message}. RigorRun reads OTLP/JSON — ` +
        'what a collector writes with the JSON exporter, or what an SDK sends over HTTP.',
    );
  }

  const spans = collectSpans(document);
  if (spans.length === 0) {
    throw new TraceParseError(
      'That JSON contains no spans RigorRun can find. It expects OTLP: either ' +
        '`{"resourceSpans":[…]}`, `{"spans":[…]}`, or a bare array of spans.',
    );
  }
  if (spans.length > MAX_SPANS) {
    throw new TraceParseError(
      `That trace has ${spans.length} spans, which is more than RigorRun will read. Export the ` +
        'one trace you want to turn into a case rather than a window of traffic.',
    );
  }

  const calls: ImportedCall[] = [];
  const failures: { name: string; message: string }[] = [];
  let unrecognised = 0;
  let model = '';
  let earliest = Number.POSITIVE_INFINITY;
  let latest = 0;

  const ids = new Set(spans.map((span) => span.spanId).filter(Boolean));
  let root: RawSpan | undefined;

  for (const span of spans) {
    const attributes = readAttributes(span.attributes);
    if (!model && typeof attributes['gen_ai.request.model'] === 'string') {
      model = attributes['gen_ai.request.model'];
    }
    const started = nanosToMs(span.startTimeUnixNano);
    const ended = nanosToMs(span.endTimeUnixNano);
    if (started > 0) earliest = Math.min(earliest, started);
    latest = Math.max(latest, ended);
    if (!root && (!span.parentSpanId || !ids.has(span.parentSpanId))) root = span;

    const call = asToolCall(span, attributes);
    if (call) {
      calls.push(call);
      if (!call.ok) {
        failures.push({ name: call.tool, message: call.error ?? 'the call failed' });
      }
      continue;
    }

    const code = span.status?.code;
    if (code === 2 || code === 'STATUS_CODE_ERROR' || code === 'ERROR') {
      failures.push({
        name: span.name ?? 'a span',
        message: span.status?.message ?? 'the span reported an error',
      });
      continue;
    }
    unrecognised += 1;
  }

  calls.sort((a, b) => a.startedAt - b.startedAt);
  const startedAt = Number.isFinite(earliest) ? earliest : 0;
  return {
    traceId: String(root?.traceId ?? spans[0]?.traceId ?? ''),
    name: root?.name ?? 'an imported trace',
    startedAt,
    durationMs: Math.max(0, latest - startedAt),
    calls,
    failures,
    unrecognised,
    model,
  };
}
