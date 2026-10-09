import { hashValue } from '@rigorrun/core';
import type { Project } from './project.ts';

/** Private provenance, separate from the public benchmark/run formats. */
export interface SuiteSource {
  version: 1;
  contractDigest: string;
  benchmarkDigest: string;
  configurationDigest: string;
  origin: 'generated' | 'pack';
  packId?: string;
}

export interface QualitySource { suite: SuiteSource; qualityDigest: string }

export class SuiteIntegrityError extends Error {
  constructor(
    readonly kind: 'missing' | 'stale',
    message: string,
    readonly runId?: string,
  ) {
    super(message);
    this.name = 'SuiteIntegrityError';
  }
}

/** Hash configuration, never resolved credentials, agent lists or run metadata. */
export function configurationDigest(project: Project, schema: unknown): Promise<string> {
  return hashValue({
    connector: project.connector,
    readOnlyTools: project.readOnlyTools,
    verifierReads: project.verifierReads,
    reset: project.reset,
    safety: project.safety,
    schemaAnswers: project.schemaAnswers,
    goal: project.goal,
    budgets: project.budgets,
    schema: schema ?? null,
  });
}

export function isSuiteSource(value: unknown): value is SuiteSource {
  if (!value || typeof value !== 'object') return false;
  const source = value as Partial<SuiteSource>;
  return source.version === 1 &&
    [source.contractDigest, source.benchmarkDigest, source.configurationDigest]
      .every((digest) => typeof digest === 'string' && /^sha256:[a-f0-9]{64}$/.test(digest)) &&
    (source.origin === 'generated' ? source.packId === undefined :
      source.origin === 'pack' && typeof source.packId === 'string' && source.packId.length > 0);
}
