/**
 * What may be verified, and what a reference means.
 *
 * Two schemes to start with. `npm:` is the one that matters — it is how most
 * MCP servers are actually distributed, and the registry hands us a content
 * digest for free. `dir:` exists for a server that is not published anywhere
 * and for our own fixtures, and its digest is deliberately shaped differently
 * so a record made from a directory can never be read as a record made from a
 * published artifact.
 *
 * Anything else is refused rather than guessed at. A reference we half-support
 * is worse than one we do not: it produces a record that looks like the others
 * and means less.
 */
import type { TargetScheme } from '@rigorrun/core';

export interface TargetRef {
  scheme: TargetScheme;
  /** Exactly what was typed. */
  raw: string;
  /** For npm: the package name. For dir: the path. */
  name: string;
  /** For npm: the version or range as written. Empty means "whatever is latest". */
  version: string;
}

const NPM_SPEC = /^(@[a-z0-9-~][a-z0-9-._~]*\/)?([a-z0-9-~][a-z0-9-._~]*)(?:@(.+))?$/;

export class ReferenceError extends Error {}

export function parseReference(input: string): TargetRef {
  const raw = input.trim();
  if (raw.length === 0) throw new ReferenceError('No server reference given.');

  const colon = raw.indexOf(':');
  const scheme = colon === -1 ? '' : raw.slice(0, colon);
  const rest = colon === -1 ? '' : raw.slice(colon + 1);

  if (scheme === 'npm') {
    const match = NPM_SPEC.exec(rest);
    if (!match) {
      throw new ReferenceError(
        `"${rest}" is not an npm package name. Expected npm:<package>@<version>, for example ` +
          'npm:@modelcontextprotocol/server-memory@2026.8.31.',
      );
    }
    return {
      scheme: 'npm',
      raw,
      name: `${match[1] ?? ''}${match[2] ?? ''}`,
      version: match[3] ?? '',
    };
  }

  if (scheme === 'dir') {
    if (rest.length === 0) throw new ReferenceError('dir: needs a path.');
    return { scheme: 'dir', raw, name: rest, version: '' };
  }

  throw new ReferenceError(
    `RigorRun does not know how to fetch "${raw}". Supported today: npm:<package>@<version> ` +
      'for a published server, and dir:<path> for one on this machine. A container image ' +
      'reference, a git ref and a remote endpoint are planned and deliberately not pretended ' +
      'to work yet.',
  );
}
