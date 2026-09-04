/**
 * Environment lookup by id.
 *
 * The runner resolving an environment through this registry rather than
 * through an `import` is what removes the last hard link between the execution
 * engine and any particular business domain.
 */
import type { EnvironmentAdapter, EnvironmentFixture } from './adapter.ts';

export interface EnvironmentRegistration {
  id: string;
  name: string;
  description: string;
  /** Builds a fresh adapter. Never reuse one across cases. */
  create(): EnvironmentAdapter;
  fixtures: readonly EnvironmentFixture[];
}

const registrations = new Map<string, EnvironmentRegistration>();

export function registerEnvironment(registration: EnvironmentRegistration): void {
  registrations.set(registration.id, registration);
}

export function getEnvironment(id: string): EnvironmentRegistration {
  const found = registrations.get(id);
  if (!found) {
    const known = [...registrations.keys()].sort().join(', ') || 'none registered';
    throw new Error(`Unknown environment "${id}". Registered environments: ${known}.`);
  }
  return found;
}

export function hasEnvironment(id: string): boolean {
  return registrations.has(id);
}

export function listEnvironments(): EnvironmentRegistration[] {
  return [...registrations.values()].sort((a, b) => a.id.localeCompare(b.id));
}

export function createEnvironment(id: string): EnvironmentAdapter {
  return getEnvironment(id).create();
}

export function fixtureFor(environmentId: string, fixtureId: string): EnvironmentFixture {
  const registration = getEnvironment(environmentId);
  const fixture = registration.fixtures.find((candidate) => candidate.id === fixtureId);
  if (!fixture) {
    const known = registration.fixtures.map((f) => f.id).sort().join(', ') || 'none';
    throw new Error(
      `Environment "${environmentId}" has no fixture "${fixtureId}". Available: ${known}.`,
    );
  }
  return fixture;
}

/** Test helper. Never called by product code. */
export function clearEnvironments(): void {
  registrations.clear();
}
