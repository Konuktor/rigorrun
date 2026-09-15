/**
 * The frame a job is held to: what its demonstration did to every kind of record.
 *
 * Requalification P9: an agent that did the job and also changed a record the job never
 * touched passed, because a job that creates records was held only to what it
 * created. The demonstration already says, for every kind of record, how many
 * were created, deleted and changed, and which fields changed. That is the
 * frame, and it is an upper bound: an agent may do less (other checks decide
 * whether the job was done), never more.
 */
import { z } from 'zod';

export const FrameEntitySchema = z.object({
  /**
   * Records of this kind when the demonstration started. None means the
   * demonstration could not show what the job does to existing records of this
   * kind, so a change to one is not something it can rule on.
   */
  preExistingRows: z.number().int().nonnegative(),
  created: z.number().int().nonnegative(),
  deleted: z.number().int().nonnegative(),
  /** Distinct existing records the demonstration changed. */
  updatedRows: z.number().int().nonnegative(),
  /** Every field the demonstration changed on them. */
  updatedFields: z.array(z.string()).default([]),
  /**
   * Whether a record of this kind is named by something stable. Without that,
   * a changed record reads as one deleted and one created.
   */
  identity: z.enum(['named', 'unestablished']),
});
export type FrameEntity = z.infer<typeof FrameEntitySchema>;

export const DemonstratedFrameSchema = z.object({
  entities: z.record(z.string(), FrameEntitySchema),
});
export type DemonstratedFrame = z.infer<typeof DemonstratedFrameSchema>;

/**
 * What a `state_frame` check expects of one case. A declined case holds the
 * job's own kind of record to nothing; every other kind keeps its demonstrated
 * bound, because one before/after reading cannot separate a remedy's side
 * effects from the job's.
 */
export const StateFrameExpectationSchema = z.object({
  mode: z.enum(['performed', 'declined']),
  focusEntity: z.string().min(1),
  entities: z.record(z.string(), FrameEntitySchema),
});
export type StateFrameExpectation = z.infer<typeof StateFrameExpectationSchema>;

/** What two readings with nothing in between showed about one kind of record. */
export interface EntityReadStability {
  /** Fields that differed for the same record: the reads changed them. */
  volatileFields: string[];
  /** The readings disagreed on which records exist. */
  membershipUnstable: boolean;
}

/** What a case changed, for one kind of record, as the runner observed it. */
export interface FrameEntityObservation {
  created: string[];
  deleted: string[];
  updated: { key: string; fields: string[] }[];
  volatileFields: string[];
  membershipUnstable: boolean;
}

/** The evidence a `state_frame` check reads, at `derived.frame`. */
export interface FrameObservation {
  proof: { baseline: 'double_read' | 'installed_seed'; final: 'double_read' };
  entities: Record<string, FrameEntityObservation>;
}
