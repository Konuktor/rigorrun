/**
 * Turning a reference into bytes, and proving they are the right bytes.
 *
 * The npm registry publishes `dist.integrity` for every version: the literal
 * text `sha512-` followed by base64 of the digest of that version's tarball.
 * That is the whole of artifact identity for this scheme, and it costs one
 * request.
 *
 * The property being defended here is narrow and worth naming: **the bytes
 * that were measured are the bytes that ran.** Resolving a version, then
 * letting a package manager fetch it again later, leaves a window in which the
 * two can differ. So the tarball is fetched once, hashed, compared to what the
 * registry said, and only then unpacked.
 *
 * A floating tag is resolved through `dist-tags` and then immediately replaced
 * by the exact version it pointed at. The record keeps both, because a
 * baseline against "latest" is not a baseline.
 */
import { sha512Base64 } from '@rigorrun/core';

export interface ResolvedPackage {
  name: string;
  version: string;
  /** `sha512-<base64>`, exactly as the registry published it. */
  integrity: string;
  tarballUrl: string;
}

export class RegistryError extends Error {}

const REGISTRY = 'https://registry.npmjs.org';

interface VersionDoc {
  version?: unknown;
  dist?: { integrity?: unknown; tarball?: unknown; shasum?: unknown };
}

function encodeName(name: string): string {
  // A scoped name's slash is the only character needing encoding here.
  return name.replace('/', '%2f');
}

async function getJson(url: string): Promise<unknown> {
  const response = await fetch(url, { headers: { accept: 'application/json' } });
  if (!response.ok) {
    throw new RegistryError(
      `The registry answered ${response.status} for ${url}. If the package name is right, ` +
        'it may not be published.',
    );
  }
  return response.json();
}

/** Resolves a name and an optional version to one exact version with a digest. */
export async function resolvePackage(name: string, version: string): Promise<ResolvedPackage> {
  let exact = version;

  if (exact === '' || exact === 'latest') {
    const doc = (await getJson(`${REGISTRY}/${encodeName(name)}`)) as {
      'dist-tags'?: Record<string, string>;
    };
    const latest = doc['dist-tags']?.['latest'];
    if (typeof latest !== 'string') {
      throw new RegistryError(`${name} publishes no "latest" version.`);
    }
    exact = latest;
  }

  const doc = (await getJson(`${REGISTRY}/${encodeName(name)}/${exact}`)) as VersionDoc;
  const resolved = typeof doc.version === 'string' ? doc.version : exact;
  const integrity = doc.dist?.integrity;
  const tarball = doc.dist?.tarball;

  if (typeof integrity !== 'string' || !integrity.startsWith('sha512-')) {
    throw new RegistryError(
      `${name}@${resolved} publishes no sha512 integrity. RigorRun will not verify a package ` +
        'it cannot pin, because the record would be about bytes it could not name.',
    );
  }
  if (typeof tarball !== 'string') {
    throw new RegistryError(`${name}@${resolved} publishes no tarball URL.`);
  }

  return { name, version: resolved, integrity, tarballUrl: tarball };
}

/** Downloads the tarball and refuses it unless it hashes to what was promised. */
export async function fetchVerifiedTarball(pkg: ResolvedPackage): Promise<Uint8Array> {
  const response = await fetch(pkg.tarballUrl);
  if (!response.ok) {
    throw new RegistryError(
      `Downloading ${pkg.name}@${pkg.version} failed with ${response.status}.`,
    );
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  const actual = `sha512-${await sha512Base64(bytes)}`;

  if (actual !== pkg.integrity) {
    // Nothing is unpacked, nothing is executed, and the run stops here.
    throw new RegistryError(
      `The tarball for ${pkg.name}@${pkg.version} does not match the digest the registry ` +
        `published.\n  expected ${pkg.integrity}\n  received ${actual}\n` +
        'RigorRun stops rather than run bytes it cannot account for.',
    );
  }
  return bytes;
}
