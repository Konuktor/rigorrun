/**
 * Worker bindings and the shapes the API accepts.
 *
 * The schemas here are deliberately narrow: the control plane stores metadata
 * and nothing else. There is no field in which a trace, a tool argument or a
 * customer's data could be posted, so a client bug cannot leak a workflow into
 * the cloud by accident.
 */
import { z } from 'zod';
// Imported as types rather than referenced globally: a global reference would
// replace the DOM lib the recorder extension depends on.
import type { D1Database } from '@cloudflare/workers-types';

export interface Env {
  DB: D1Database;
  RIGORRUN_ENV?: string;
  REPORT_RETENTION_DAYS?: string;
}

export const WorkflowInputSchema = z.object({
  id: z.string().min(1).max(120),
  name: z.string().min(1).max(200),
  goal: z.string().min(1).max(500),
  environment: z.string().min(1).max(80),
  contractHash: z.string().regex(/^sha256:[0-9a-f]{64}$/),
  ruleCounts: z.object({
    observed: z.number().int().nonnegative().max(10_000),
    inferred: z.number().int().nonnegative().max(10_000),
    confirmed: z.number().int().nonnegative().max(10_000),
  }),
  openQuestions: z.number().int().nonnegative().max(10_000),
  cases: z
    .array(
      z.object({
        caseId: z.string().min(1).max(120),
        name: z.string().min(1).max(200),
        category: z.string().min(1).max(60),
        checkCount: z.number().int().nonnegative().max(1000),
      }),
    )
    .max(500)
    .default([]),
});
export type WorkflowInput = z.infer<typeof WorkflowInputSchema>;

export const RunInputSchema = z.object({
  id: z.string().min(1).max(120),
  workflowId: z.string().max(120).optional(),
  benchmarkHash: z.string().regex(/^sha256:[0-9a-f]{64}$/),
  contractHash: z.string().regex(/^sha256:[0-9a-f]{64}$/),
  environment: z.string().min(1).max(80),
  agentCount: z.number().int().nonnegative().max(100),
  caseCount: z.number().int().nonnegative().max(5000),
  startedAt: z.string().max(40),
});
export type RunInput = z.infer<typeof RunInputSchema>;

export const RunResultsInputSchema = z.object({
  resultHash: z.string().regex(/^sha256:[0-9a-f]{64}$/),
  finishedAt: z.string().max(40),
  verdict: z.string().max(400),
  winnerAgentId: z.string().max(120).nullable(),
  caseResults: z
    .array(
      z.object({
        caseId: z.string().min(1).max(120),
        agentId: z.string().min(1).max(120),
        category: z.string().min(1).max(60),
        taskSuccess: z.boolean(),
        policyCompliant: z.boolean(),
        unsafeActions: z.number().int().nonnegative().max(1000),
        durationMs: z.number().nonnegative().max(3_600_000),
      }),
    )
    .max(5000),
});
export type RunResultsInput = z.infer<typeof RunResultsInputSchema>;

/** A published report carries scores and outcomes — never workflow content. */
export const PublishInputSchema = z.object({
  runId: z.string().min(1).max(120),
  title: z.string().min(1).max(200),
  scores: z
    .array(
      z.object({
        agentId: z.string().max(120),
        agentName: z.string().max(200),
        n: z.number().int().nonnegative().max(100_000),
        taskSuccessRate: z.number().min(0).max(1),
        taskSuccessLower: z.number().min(0).max(1),
        taskSuccessUpper: z.number().min(0).max(1),
        policyComplianceRate: z.number().min(0).max(1),
        unsafeActions: z.number().int().nonnegative().max(100_000),
        thresholdsPassed: z.boolean(),
      }),
    )
    .max(50),
  benchmarkHash: z.string().regex(/^sha256:[0-9a-f]{64}$/),
  contractHash: z.string().regex(/^sha256:[0-9a-f]{64}$/),
  caseCategories: z.array(z.string().max(60)).max(200).default([]),
});
export type PublishInput = z.infer<typeof PublishInputSchema>;
