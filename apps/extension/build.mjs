/**
 * Builds the unpacked extension and a zip for easy installation.
 *
 * The extension bundles @rigorrun/core so the recorder uses the exact same
 * redaction and selector ranking the rest of the product does.
 */
import { build } from 'esbuild';
import { cp, mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
/** A 128px dark tile carrying the RR wordmark. */
const ICON_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAIAAAACACAYAAADDPmHLAAAAAXNSR0IArs4c6QAAAKBJREFUeF7t0AENAAAAwqD3T20ON6AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAeBoMDwABQZ0m2QAAAABJRU5ErkJggg==';
const repoRoot = join(here, '..', '..');
const outDir = join(repoRoot, 'dist', 'rigorrun-extension');
const zipPath = join(repoRoot, 'dist', 'rigorrun-extension.zip');
// No alias: pnpm links @rigorrun/core into this package, and core's `exports`
// map lets the recorder import individual leaf modules rather than the whole
// entry point.

await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });

await build({
  entryPoints: [
    join(here, 'src', 'content.ts'),
    join(here, 'src', 'background.ts'),
    join(here, 'src', 'popup.ts'),
  ],
  bundle: true,
  format: 'esm',
  target: 'chrome114',
  outdir: outDir,
  logLevel: 'warning',
});

// The content script is injected classically, so it must not be a module.
await build({
  entryPoints: [join(here, 'src', 'content.ts')],
  bundle: true,
  format: 'iife',
  target: 'chrome114',
  outfile: join(outDir, 'content.js'),
  logLevel: 'warning',
  allowOverwrite: true,
});

await cp(join(here, 'manifest.json'), join(outDir, 'manifest.json'));
await cp(join(here, 'src', 'popup.html'), join(outDir, 'popup.html'));
await cp(join(here, 'src', 'popup.css'), join(outDir, 'popup.css'));
await writeFile(join(outDir, 'icon128.png'), Buffer.from(ICON_BASE64, 'base64'));

// Refuse to ship a bundle containing anything secret-shaped.
const SECRET_PATTERNS = [/sk-[A-Za-z0-9]{16,}/, /gsk_[A-Za-z0-9]{16,}/, /AIza[0-9A-Za-z_-]{20,}/];
for (const file of await readdir(outDir)) {
  const path = join(outDir, file);
  if ((await stat(path)).isDirectory()) continue;
  const text = await import('node:fs/promises').then((fs) => fs.readFile(path, 'utf8')).catch(() => '');
  for (const pattern of SECRET_PATTERNS) {
    if (pattern.test(text)) throw new Error(`Refusing to package ${file}: it matches ${pattern}`);
  }
}

await zip(outDir, zipPath);
console.log(`built ${relative(repoRoot, outDir)} and ${relative(repoRoot, zipPath)}`);

/** Uses the system `zip` when available, otherwise writes a stored-entry zip. */
async function zip(sourceDir, target) {
  await rm(target, { force: true });
  try {
    await promisify(execFile)('zip', ['-qr', target, '.'], { cwd: sourceDir });
    return;
  } catch {
    // Fall through to the dependency-free writer below.
  }
  await writeStoredZip(sourceDir, target);
}

async function writeStoredZip(sourceDir, target) {
  const { readFile } = await import('node:fs/promises');
  const { deflateRawSync, crc32 } = await import('node:zlib');
  const files = await readdir(sourceDir);
  const chunks = [];
  const central = [];
  let offset = 0;

  for (const name of files) {
    const data = await readFile(join(sourceDir, name));
    const compressed = deflateRawSync(data);
    const crc = crc32 ? crc32(data) : 0;
    const nameBuf = Buffer.from(name, 'utf8');

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    chunks.push(local, nameBuf, compressed);

    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(20, 6);
    header.writeUInt16LE(8, 10);
    header.writeUInt32LE(crc, 16);
    header.writeUInt32LE(compressed.length, 20);
    header.writeUInt32LE(data.length, 24);
    header.writeUInt16LE(nameBuf.length, 28);
    header.writeUInt32LE(offset, 42);
    central.push(header, nameBuf);

    offset += local.length + nameBuf.length + compressed.length;
  }

  const centralBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);

  await new Promise((resolve, reject) => {
    const stream = createWriteStream(target);
    stream.on('error', reject);
    stream.on('close', resolve);
    stream.write(Buffer.concat([...chunks, centralBuf, end]));
    stream.end();
  });
}

