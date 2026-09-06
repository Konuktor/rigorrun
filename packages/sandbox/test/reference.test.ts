import { describe, expect, it } from 'vitest';
import { parseReference, ReferenceError } from '../src/index.ts';

describe('server references', () => {
  it('keeps what was typed alongside what it resolved to', () => {
    const ref = parseReference('npm:@modelcontextprotocol/server-memory@2026.8.31');
    expect(ref).toEqual({
      scheme: 'npm',
      raw: 'npm:@modelcontextprotocol/server-memory@2026.8.31',
      name: '@modelcontextprotocol/server-memory',
      version: '2026.8.31',
    });
  });

  it('accepts an unscoped package and a bare name', () => {
    expect(parseReference('npm:some-server@1.2.3').name).toBe('some-server');
    expect(parseReference('npm:some-server').version).toBe('');
  });

  it('accepts a local directory', () => {
    expect(parseReference('dir:fixtures/external/x')).toMatchObject({
      scheme: 'dir',
      name: 'fixtures/external/x',
    });
  });

  /**
   * A half-supported reference is worse than an unsupported one: it produces a
   * record that looks like the others and means less.
   */
  it('refuses every scheme it cannot actually honour', () => {
    for (const bad of [
      'oci:ghcr.io/x/y:1',
      'git:https://github.com/x/y',
      'https://example.com/mcp',
      'file:///tmp/x',
      './local/path',
      '@modelcontextprotocol/server-memory',
      '',
    ]) {
      expect(() => parseReference(bad)).toThrow(ReferenceError);
    }
  });

  it('says what it does support when it refuses', () => {
    expect(() => parseReference('oci:x')).toThrow(/npm:<package>@<version>/);
  });

  it('refuses a package name carrying shell punctuation', () => {
    expect(() => parseReference('npm:evil;rm -rf /')).toThrow(ReferenceError);
    expect(() => parseReference('npm:../../etc/passwd')).toThrow(ReferenceError);
  });
});
