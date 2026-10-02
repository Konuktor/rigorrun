import type {
  ActionDefinition,
  ActionResult,
  CanonicalState,
  PackBindings,
  PackCaseContext,
  PackMaterialization,
  PackScope,
  PackSession,
  SafetyMode,
} from '@rigorrun/environment';
import { createHelpdeskClient, type HelpdeskClient } from './client.ts';
import { TWIN_URL } from './conventions.ts';
import { materializeHelpdeskCase } from './materialize.ts';
import { readHelpdeskState } from './read.ts';
import { describeHelpdeskReality } from './reality.ts';

export interface HelpdeskSessionOptions {
  mode: 'twin' | 'live';
  baseUrl?: string;
  safety?: SafetyMode;
  fetch?: typeof fetch;
}

export async function openHelpdeskSession(options: HelpdeskSessionOptions): Promise<PackSession> {
  if (options.mode !== 'twin') {
    throw new Error(
      'The Larch Helpdesk pack supports twin mode only; a live helpdesk connection is not built.',
    );
  }
  const client = createHelpdeskClient(options.baseUrl ?? TWIN_URL, options.fetch);
  return new HelpdeskSession(client, options.safety ?? 'local');
}

export class HelpdeskSession implements PackSession {
  readonly system = 'Larch Helpdesk (twin)';
  readonly simulated = true;
  readonly isolation = 'replaced-world' as const;
  readonly completeRead = true;

  constructor(
    private readonly client: HelpdeskClient,
    readonly safety: SafetyMode = 'local',
  ) {}

  materialize(recipe: unknown, _ctx: PackCaseContext): Promise<PackMaterialization> {
    return materializeHelpdeskCase(recipe, this.client);
  }

  read(_scope: PackScope | null): Promise<CanonicalState> {
    return readHelpdeskState(this.client);
  }

  reality(seed: CanonicalState, final: CanonicalState, _bindings: PackBindings): string[] {
    return describeHelpdeskReality(seed, final);
  }

  actions(): ActionDefinition[] {
    return [];
  }

  execute(_name: string, _args: Record<string, unknown>): Promise<ActionResult> {
    return Promise.reject(
      new Error('Larch Helpdesk agents are black boxes; the pack does not execute their tools.'),
    );
  }

  close(): Promise<void> {
    return Promise.resolve();
  }
}
