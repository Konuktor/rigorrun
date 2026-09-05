/**
 * Reading a trace of something that already went wrong.
 *
 * Two things are being tested and the second matters more.
 *
 * That the common shapes are read — OTLP as a collector writes it, the flatter
 * shape several SDKs write, attributes as OTLP's typed key/value list and as a
 * plain object, and tool calls under four different conventions because the
 * GenAI semantic conventions are the newest and least settled thing in
 * OpenTelemetry.
 *
 * And that a trace from a runtime this reader has never seen produces a
 * *partial* answer with a count of what it skipped, rather than an error. The
 * people with a failure to explain are not the people who already use whichever
 * framework an importer was written against.
 */
import { describe, expect, it } from 'vitest';
import { TraceParseError, importOtelTrace } from '../src/index.ts';

const ns = (ms: number): string => String(ms * 1e6);

/** OTLP as a collector's JSON exporter writes it. */
const OTLP = JSON.stringify({
  resourceSpans: [
    {
      resource: { attributes: [{ key: 'service.name', value: { stringValue: 'booking-agent' } }] },
      scopeSpans: [
        {
          spans: [
            {
              traceId: 'abc123',
              spanId: 'root',
              name: 'confirm booking',
              startTimeUnixNano: ns(1000),
              endTimeUnixNano: ns(4200),
              status: { code: 2, message: 'the booking was confirmed without a sign-off' },
              attributes: [{ key: 'gen_ai.request.model', value: { stringValue: 'a-model' } }],
            },
            {
              traceId: 'abc123',
              spanId: 'a',
              parentSpanId: 'root',
              name: 'execute_tool get_booking',
              startTimeUnixNano: ns(1100),
              endTimeUnixNano: ns(1400),
              status: { code: 1 },
              attributes: [
                { key: 'gen_ai.tool.name', value: { stringValue: 'get_booking' } },
                {
                  key: 'gen_ai.tool.call.arguments',
                  value: { stringValue: '{"bookingId":"BKG-4002"}' },
                },
              ],
            },
            {
              traceId: 'abc123',
              spanId: 'b',
              parentSpanId: 'root',
              name: 'execute_tool confirm_booking',
              startTimeUnixNano: ns(1500),
              endTimeUnixNano: ns(4000),
              status: { code: 1 },
              attributes: [
                { key: 'gen_ai.tool.name', value: { stringValue: 'confirm_booking' } },
                {
                  key: 'gen_ai.tool.call.arguments',
                  value: { stringValue: '{"bookingId":"BKG-4002"}' },
                },
              ],
            },
          ],
        },
      ],
    },
  ],
});

describe('reading an OTLP trace', () => {
  it('finds the calls, in the order they happened', () => {
    const imported = importOtelTrace(OTLP);
    expect(imported.traceId).toBe('abc123');
    expect(imported.name).toBe('confirm booking');
    expect(imported.calls.map((call) => call.tool)).toEqual(['get_booking', 'confirm_booking']);
    expect(imported.calls[0]?.args).toEqual({ bookingId: 'BKG-4002' });
    expect(imported.model).toBe('a-model');
  });

  it('carries what went wrong, in the words the trace used', () => {
    const imported = importOtelTrace(OTLP);
    expect(imported.failures).toHaveLength(1);
    expect(imported.failures[0]?.message).toMatch(/without a sign-off/);
  });

  it('measures how long it took from the spans rather than guessing', () => {
    const imported = importOtelTrace(OTLP);
    expect(imported.startedAt).toBe(1000);
    expect(imported.durationMs).toBe(3200);
    expect(imported.calls[1]?.durationMs).toBe(2500);
  });
});

describe('reading a trace from a runtime nobody wrote this for', () => {
  it('accepts a flat document with plain-object attributes', () => {
    // What a great many SDKs actually write, rather than what the spec shows.
    const imported = importOtelTrace(
      JSON.stringify({
        spans: [
          {
            spanId: 'x',
            name: 'agent run',
            startTimeUnixNano: ns(0),
            endTimeUnixNano: ns(500),
          },
          {
            spanId: 'y',
            parentSpanId: 'x',
            name: 'tool.execute',
            startTimeUnixNano: ns(100),
            endTimeUnixNano: ns(200),
            attributes: { 'tool.name': 'record_signoff', 'tool.arguments': { approver: 'Dana' } },
          },
        ],
      }),
    );
    expect(imported.calls).toHaveLength(1);
    expect(imported.calls[0]).toMatchObject({
      tool: 'record_signoff',
      args: { approver: 'Dana' },
      recognisedBy: 'tool.name',
    });
  });

  it('recognises a tool call from the span name alone', () => {
    // The oldest convention there is, and still common.
    const imported = importOtelTrace(
      JSON.stringify([
        { spanId: 'z', name: 'tool:list_venues', startTimeUnixNano: ns(0), endTimeUnixNano: ns(50) },
      ]),
    );
    expect(imported.calls[0]).toMatchObject({ tool: 'list_venues', recognisedBy: 'span name' });
  });

  it('says how much it did not understand rather than failing', () => {
    const imported = importOtelTrace(
      JSON.stringify({
        spans: [
          { spanId: 'a', name: 'agent run', startTimeUnixNano: ns(0), endTimeUnixNano: ns(9) },
          { spanId: 'b', parentSpanId: 'a', name: 'something.internal' },
          { spanId: 'c', parentSpanId: 'a', name: 'another.internal' },
          {
            spanId: 'd',
            parentSpanId: 'a',
            name: 'tool.execute',
            attributes: { 'mcp.tool.name': 'find_bookings' },
          },
        ],
      }),
    );
    // What it found, and what it did not — rather than an error that hides
    // whatever was recognisable.
    expect(imported.calls.map((call) => call.tool)).toEqual(['find_bookings']);
    expect(imported.unrecognised).toBe(3);
  });

  it('keeps a call whose arguments it cannot read, and says nothing about them', () => {
    const imported = importOtelTrace(
      JSON.stringify([
        {
          spanId: 'a',
          name: 'tool.execute',
          attributes: { 'tool.name': 'confirm_booking', 'tool.arguments': 'not json at all' },
        },
      ]),
    );
    // Inventing arguments would be worse than admitting there are none.
    expect(imported.calls[0]).toMatchObject({ tool: 'confirm_booking', args: {} });
  });
});

describe('refusing what it cannot read', () => {
  it('says what shape it wanted', () => {
    expect(() => importOtelTrace('not json')).toThrow(TraceParseError);
    expect(() => importOtelTrace('{"nope":1}')).toThrow(/resourceSpans/);
  });

  it('refuses a window of traffic rather than one trace', () => {
    const many = { spans: Array.from({ length: 20_001 }, (_, i) => ({ spanId: `s${i}`, name: 'x' })) };
    expect(() => importOtelTrace(JSON.stringify(many))).toThrow(/one trace/);
  });
});
