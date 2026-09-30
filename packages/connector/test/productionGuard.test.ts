/**
 * On a system marked production, RigorRun never writes on its own behalf.
 *
 * The runner already refuses an agent's writes there. These are the other
 * doors: the reset RigorRun calls before a demonstration and before every case,
 * and any action RigorRun executes itself (a generation probe, a teaching step).
 * Reads a person confirmed as read-only stay open, because a production project
 * that cannot even be read is a project nobody can check.
 */
import { describe, expect, it } from 'vitest';
import type { EnvironmentSchema } from '@rigorrun/environment';
import {
  ProductionWriteRefused,
  SystemEnvironment,
  type DiscoveredTool,
  type SystemConnection,
  type SystemEnvironmentConfig,
} from '../src/index.ts';

const SCHEMA: EnvironmentSchema = { entities: [], relationships: [] };

function recordingConnection(): { connection: SystemConnection; called: string[] } {
  const called: string[] = [];
  const connection: SystemConnection = {
    discovery: {
      serverName: 'fake',
      serverVersion: '1',
      protocolVersion: '',
      latencyMs: 0,
      tools: ['read_items', 'write_item', 'reset_all'].map(
        (name) =>
          ({ name, description: name, params: [], unsupported: [], schemaTruncated: false, hints: {}, risk: {} }) as unknown as DiscoveredTool,
      ),
    },
    childPid: null,
    call: async (name) => {
      called.push(name);
      return { ok: true, durationMs: 0, structured: { items: [] } };
    },
    close: async () => undefined,
  };
  return { connection, called };
}

function config(safety: SystemEnvironmentConfig['safety']): SystemEnvironmentConfig {
  return {
    id: 'fake',
    name: 'Fake',
    description: '',
    verifierReads: [{ tool: 'read_items' }],
    reset: { kind: 'tool', tool: 'reset_all' },
    safety,
    readOnlyTools: ['read_items'],
  };
}

describe('a production system', () => {
  it('refuses the reset RigorRun would call, and never calls it', async () => {
    const { connection, called } = recordingConnection();
    const environment = new SystemEnvironment(connection, SCHEMA, config('production'));
    await expect(environment.reset()).rejects.toBeInstanceOf(ProductionWriteRefused);
    expect(called).not.toContain('reset_all');
  });

  it('refuses a write RigorRun executes itself, and never sends it', async () => {
    const { connection, called } = recordingConnection();
    const environment = new SystemEnvironment(connection, SCHEMA, config('production'));
    const result = await environment.executeAction('write_item', { label: 'x' });
    expect(result.ok).toBe(false);
    expect(result.ok ? '' : result.error?.code).toBe('WRITE_REFUSED');
    expect(called).not.toContain('write_item');
  });

  it('still lets a confirmed read-only tool through', async () => {
    const { connection, called } = recordingConnection();
    const environment = new SystemEnvironment(connection, SCHEMA, config('production'));
    const result = await environment.executeAction('read_items', {});
    expect(result.ok).toBe(true);
    expect(called).toEqual(['read_items']);
  });
});

describe('a staging system', () => {
  it('resets and writes as before', async () => {
    const { connection, called } = recordingConnection();
    const environment = new SystemEnvironment(connection, SCHEMA, config('staging'));
    await environment.reset();
    await environment.executeAction('write_item', { label: 'x' });
    expect(called).toEqual(['reset_all', 'write_item']);
  });
});
