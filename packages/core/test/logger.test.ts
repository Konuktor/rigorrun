import { describe, expect, it } from 'vitest';
import { Logger, memorySink, parseLogLevel } from '@rigorrun/core';

describe('Logger', () => {
  it('respects the level threshold', () => {
    const { sink, records } = memorySink();
    const log = new Logger({ level: 'warn', sink });
    log.debug('no');
    log.info('no');
    log.warn('yes');
    log.error('yes');
    expect(records.map((r) => r.level)).toEqual(['warn', 'error']);
  });

  it('never emits a secret that was passed as log data', () => {
    const { sink, records } = memorySink();
    new Logger({ level: 'debug', sink }).info('calling provider', {
      apiKey: 'gsk_abcdefghijklmnopqrstuvwx',
      model: 'openai/gpt-oss-120b',
    });
    const serialised = JSON.stringify(records);
    expect(serialised).not.toContain('gsk_abcdefghijklmnopqrstuvwx');
    expect(serialised).toContain('openai/gpt-oss-120b');
  });

  it('tags child records with a correlation id', () => {
    const { sink, records } = memorySink();
    new Logger({ sink }).child('run_abc').info('started');
    expect(records[0]?.correlationId).toBe('run_abc');
  });

  it('silences everything at level silent', () => {
    const { sink, records } = memorySink();
    const log = new Logger({ level: 'silent', sink });
    log.error('nope');
    expect(records).toHaveLength(0);
  });

  it('parses log levels defensively', () => {
    expect(parseLogLevel('DEBUG')).toBe('debug');
    expect(parseLogLevel('nonsense')).toBe('info');
    expect(parseLogLevel(undefined, 'warn')).toBe('warn');
  });
});
