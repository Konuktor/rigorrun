/**
 * The point of the capability model is that RigorRun says less when it knows
 * less. These tests are about the *saying*, not the knowing.
 */
import { describe, expect, it } from 'vitest';
import {
  FULL_CAPABILITIES,
  capabilityLimits,
  isolationLevel,
  mayMutateAtAll,
  mayRepeatMutatingCases,
  verificationStrength,
  type EnvironmentCapabilities,
} from '../src/capabilities.ts';

/** A plausible real system: some read tools, no way to install a world. */
const REALISTIC: EnvironmentCapabilities = {
  discovery: 'tools-only',
  stateRead: 'designated-reads',
  seed: 'none',
  reset: 'tool',
  events: 'proxy-log',
  safety: 'staging',
};

/** The worst honest case: a thing you can call and never inspect. */
const OPAQUE: EnvironmentCapabilities = {
  discovery: 'tools-only',
  stateRead: 'none',
  seed: 'none',
  reset: 'none',
  events: 'proxy-log',
  safety: 'production',
};

describe('what a verdict is worth', () => {
  it('is authoritative only when the whole system can be read back', () => {
    expect(verificationStrength(FULL_CAPABILITIES)).toBe('AUTHORITATIVE');
  });

  it('is partial when only nominated reads are available', () => {
    expect(verificationStrength(REALISTIC)).toBe('PARTIAL');
  });

  it('is observational when nothing can be read back', () => {
    expect(verificationStrength(OPAQUE)).toBe('OBSERVATIONAL');
    // The distinction that matters: this is not a low score, it is a different
    // kind of claim, and nothing downstream may round it up to a passing one.
    expect(verificationStrength(OPAQUE)).not.toBe('AUTHORITATIVE');
  });
});

describe('isolation between cases', () => {
  it('is real when the reset is ours to perform', () => {
    // A snapshot of a JavaScript object is something this code does.
    expect(isolationLevel(FULL_CAPABILITIES)).toBe('RESET');
  });

  it("is only DECLARED when the reset is somebody else's promise", () => {
    // A nominated tool has never been called twice and compared. Reporting
    // that as RESET claimed a measurement nobody took.
    expect(isolationLevel(REALISTIC)).toBe('DECLARED');
    expect(isolationLevel(REALISTIC)).not.toBe('RESET');
  });

  it('upgrades to a measurement when a caller supplies one', () => {
    expect(isolationLevel(REALISTIC, { stable: true, pathsStable: true })).toBe('RESET');
    expect(isolationLevel(REALISTIC, { stable: false, pathsStable: true })).toBe('PARTIAL');
    expect(isolationLevel(REALISTIC, { stable: false, pathsStable: false })).toBe('NONE');
  });

  it('is absent without a reset, and repetition is refused', () => {
    expect(isolationLevel(OPAQUE)).toBe('NONE');
    expect(mayRepeatMutatingCases(OPAQUE)).toBe(false);
    expect(mayRepeatMutatingCases(REALISTIC)).toBe(true);
  });
});

describe('production', () => {
  it('is the one safety mode that forbids writing', () => {
    expect(mayMutateAtAll(OPAQUE)).toBe(false);
    for (const safety of ['staging', 'local', 'ephemeral'] as const) {
      expect(mayMutateAtAll({ ...OPAQUE, safety })).toBe(true);
    }
  });
});

describe('the limits shown to a person', () => {
  it('says nothing about an environment that can do everything', () => {
    expect(capabilityLimits(FULL_CAPABILITIES)).toEqual([]);
  });

  it('names each missing capability and what would lift it', () => {
    const limits = capabilityLimits(REALISTIC);
    const ids = limits.map((limit) => limit.id).sort();
    expect(ids).toEqual(['induced_schema', 'no_seed', 'partial_state_read']);
    // A limit a person can act on must come with the action.
    expect(limits.find((l) => l.id === 'partial_state_read')?.remedy).toMatch(/read operations/);
    // A limit nobody can act on says so by saying nothing, rather than
    // inventing advice.
    expect(limits.find((l) => l.id === 'no_seed')?.remedy).toBe('');
  });

  it('reports every limit of an opaque production system at once', () => {
    const ids = capabilityLimits(OPAQUE)
      .map((limit) => limit.id)
      .sort();
    expect(ids).toEqual(['induced_schema', 'no_reset', 'no_seed', 'no_state_read', 'production']);
  });

  it('is written for reading, not for logging', () => {
    for (const limit of capabilityLimits(OPAQUE)) {
      expect(limit.limit.length).toBeGreaterThan(30);
      expect(limit.limit).toMatch(/[a-z]\.$/);
    }
  });
});

/** A system with no reset at all, where every case makes its own records. */
const MATERIALIZED: EnvironmentCapabilities = {
  discovery: 'declared-schema',
  stateRead: 'designated-reads',
  stateReadIndependence: 'independent',
  seed: 'materialized',
  reset: 'namespace',
  events: 'proxy-log',
  safety: 'staging',
};

describe('cases that make their own records', () => {
  it('are isolated by construction, and say so rather than claiming a reset', () => {
    expect(isolationLevel(MATERIALIZED)).toBe('FRESH_OBJECTS');
    // Two resets compared say nothing about a namespace, which puts nothing
    // back; a measurement must not be able to turn this into RESET.
    expect(isolationLevel(MATERIALIZED, { stable: true, pathsStable: true })).toBe('FRESH_OBJECTS');
  });

  it('may be repeated, because every attempt starts from records of its own', () => {
    expect(mayRepeatMutatingCases(MATERIALIZED)).toBe(true);
  });

  it('are not isolated by a namespace alone', () => {
    // Reading only "this case's" records when the case created none is reading
    // nothing, from a world every case shares.
    const shared = { ...MATERIALIZED, seed: 'none' as const };
    expect(isolationLevel(shared)).toBe('NONE');
    expect(mayRepeatMutatingCases(shared)).toBe(false);
  });

  it('say their reads are scoped to the case, with no remedy to invent', () => {
    const limits = capabilityLimits(MATERIALIZED);
    expect(limits.map((limit) => limit.id)).toEqual(['scoped_state_read']);
    expect(limits[0]?.remedy).toBe('');
  });
});

describe('a simulated system', () => {
  it('is named as one on every run against it', () => {
    const limits = capabilityLimits({ ...MATERIALIZED, simulated: true });
    const simulated = limits.find((limit) => limit.id === 'simulated');
    expect(simulated?.limit).toMatch(/local twin, not the real system/);
    expect(simulated?.remedy).toMatch(/real system/);
  });

  it('is never assumed: absent and false both mean the real system', () => {
    for (const caps of [MATERIALIZED, { ...MATERIALIZED, simulated: false }, FULL_CAPABILITIES]) {
      expect(capabilityLimits(caps).some((limit) => limit.id === 'simulated')).toBe(false);
    }
  });

  it('does not change what else the run may claim', () => {
    const twin = { ...MATERIALIZED, simulated: true };
    expect(verificationStrength(twin)).toBe(verificationStrength(MATERIALIZED));
    expect(isolationLevel(twin)).toBe('FRESH_OBJECTS');
  });
});
