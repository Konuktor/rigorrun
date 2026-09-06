/**
 * Comparing what a server declared against what it was seen to do.
 *
 * `packages/connector/src/risk.ts` already answers "did a tool claiming to be
 * read-only change state?" — this is the same question asked properly for a
 * record, and it differs from that function in three ways that matter.
 *
 *   1. It has three answers, not two. `detectMismatch` returns a mismatch or
 *      `undefined`, and `undefined` means both "it conformed" and "we could not
 *      tell". Those are opposite results and a record must not conflate them.
 *
 *   2. It covers all three behavioural hints, not just `readOnlyHint`.
 *
 *   3. It knows which surface saw the evidence, and refuses to convict on the
 *      weakest one.
 *
 * That last rule is the important one. If the only thing that noticed a state
 * change was the server's own read tools, then the server that may be
 * misdeclaring the tool is also the sole witness. That is corroboration, never
 * proof, so it can raise confidence in a contradiction found elsewhere but can
 * never establish one alone.
 */
import type { ServerHints } from '@rigorrun/connector';
import type {
  Conformance,
  ConformanceVerdict,
  FailureSeverity,
  StateSurfaceId,
} from '@rigorrun/core';

/** What execution established about one tool. */
export interface ObservedBehavior {
  /** Undetermined is a real answer and is never collapsed to `false`. */
  mutatesState: 'yes' | 'no' | 'undetermined';
  /** Whether anything was deleted or overwritten, as opposed to added. */
  destroyed: 'yes' | 'no' | 'undetermined';
  /** Whether a second identical call changed state again. */
  idempotent: 'yes' | 'no' | 'not-probed';
  /** Which surfaces produced a reading at all. */
  surfaces: readonly StateSurfaceId[];
  /** The case that proves it. */
  evidenceRef: string;
}

/** Surfaces strong enough to convict on. */
const AUTHORITATIVE_SURFACES: readonly StateSurfaceId[] = ['container_fs', 'process_table'];

function strongestSurface(surfaces: readonly StateSurfaceId[]): StateSurfaceId | undefined {
  return (
    AUTHORITATIVE_SURFACES.find((s) => surfaces.includes(s)) ??
    (surfaces.includes('server_reads') ? 'server_reads' : undefined)
  );
}

/** Whether a contradiction may be asserted from what saw it. */
function canConvict(surfaces: readonly StateSurfaceId[]): boolean {
  return AUTHORITATIVE_SURFACES.some((s) => surfaces.includes(s));
}

function entry(
  claim: string,
  verdict: ConformanceVerdict,
  severity: FailureSeverity,
  permissionRelevant: boolean,
  because: string,
  observed: ObservedBehavior,
): Conformance {
  const surface = strongestSurface(observed.surfaces);
  return {
    claim,
    verdict,
    severity,
    permissionRelevant,
    because,
    ...(surface ? { surface } : {}),
    evidenceRef: observed.evidenceRef,
  };
}

/**
 * The verdicts for one tool.
 *
 * A hint the server did not set produces nothing at all — an absent annotation
 * is not a claim, and inventing a verdict for it would pad the record with
 * findings nobody made.
 */
export function judge(hints: ServerHints, observed: ObservedBehavior): Conformance[] {
  const out: Conformance[] = [];

  if (hints.readOnly === true) {
    const claim = 'readOnlyHint: true';
    if (observed.mutatesState === 'yes' && canConvict(observed.surfaces)) {
      out.push(
        entry(
          claim,
          'CONTRADICTED',
          'CRITICAL',
          true,
          'the tool declares itself read-only and was observed changing state RigorRun read ' +
            'independently of the server',
          observed,
        ),
      );
    } else if (observed.mutatesState === 'yes') {
      out.push(
        entry(
          claim,
          'UNDETERMINED',
          'INFO',
          false,
          'a change was seen only through the server’s own tools, which is the same server ' +
            'that would have to be wrong for this to be a contradiction',
          observed,
        ),
      );
    } else if (observed.mutatesState === 'no' && canConvict(observed.surfaces)) {
      out.push(entry(claim, 'CONFORMS', 'INFO', false, 'no state change was observed', observed));
    } else {
      out.push(
        entry(
          claim,
          'UNDETERMINED',
          'INFO',
          false,
          'RigorRun could not read any state that would prove or disprove this',
          observed,
        ),
      );
    }
  }

  if (hints.readOnly === false) {
    // Not a security problem. It matters because a "write" that writes nothing
    // produces cases with no observable outcome, which is a suite defect.
    const claim = 'readOnlyHint: false';
    if (observed.mutatesState === 'no' && canConvict(observed.surfaces)) {
      out.push(
        entry(
          claim,
          'CONTRADICTED',
          'MINOR',
          false,
          'the tool declares that it writes, and nothing RigorRun can read changed',
          observed,
        ),
      );
    } else if (observed.mutatesState === 'yes') {
      out.push(entry(claim, 'CONFORMS', 'INFO', false, 'the tool changed state, as declared', observed));
    } else {
      out.push(
        entry(claim, 'UNDETERMINED', 'INFO', false, 'no state was readable either way', observed),
      );
    }
  }

  if (hints.destructive === false) {
    const claim = 'destructiveHint: false';
    if (observed.destroyed === 'yes' && canConvict(observed.surfaces)) {
      out.push(
        entry(
          claim,
          'CONTRADICTED',
          'CRITICAL',
          true,
          'the tool declares that it destroys nothing, and was observed deleting or ' +
            'overwriting existing state',
          observed,
        ),
      );
    } else if (observed.destroyed === 'no' && canConvict(observed.surfaces)) {
      out.push(
        entry(claim, 'CONFORMS', 'INFO', false, 'nothing was deleted or overwritten', observed),
      );
    } else {
      out.push(
        entry(
          claim,
          'UNDETERMINED',
          'INFO',
          false,
          'RigorRun could not establish whether anything was destroyed',
          observed,
        ),
      );
    }
  }

  if (hints.idempotent === true) {
    const claim = 'idempotentHint: true';
    if (observed.idempotent === 'no' && canConvict(observed.surfaces)) {
      out.push(
        entry(
          claim,
          'CONTRADICTED',
          'MAJOR',
          false,
          'a second identical call changed state again, so repeating it is not free',
          observed,
        ),
      );
    } else if (observed.idempotent === 'yes') {
      out.push(
        entry(claim, 'CONFORMS', 'INFO', false, 'a second identical call changed nothing', observed),
      );
    } else {
      out.push(
        entry(
          claim,
          'UNDETERMINED',
          'INFO',
          false,
          'the tool was not called twice, so idempotence was not tested',
          observed,
        ),
      );
    }
  }

  return out;
}
