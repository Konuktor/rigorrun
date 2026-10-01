#!/usr/bin/env node
/**
 * Photographs rigorrun.xyz as a visitor sees it.
 *
 *   node scripts/capture-assets.mjs [--base <url> | --dist <dir>] [--out <dir>]
 *
 * `--base` photographs a deployed site (https://rigorrun.xyz by default);
 * `--dist` serves a local build, such as apps/site/dist after
 * `pnpm build:site`, and photographs that. Nothing is mocked or composited:
 * these are the pages as they arrive, with the fonts they ship.
 *
 * It writes three images and checks one promise the landing page makes:
 *
 *  - landing-desktop.png — the first screen at 1440x900.
 *  - landing-mobile.png  — the first screen at 390x844.
 *  - replay-headline.png — the headline case on /replay, as the card it is
 *    shown in, when the recording the site was built from has one.
 *
 * The promise: `npx rigorrun demo` is on the first screen at 1440x900. Things
 * get added to a hero over time (a video, a badge, a line of copy) and each one
 * pushes the command a little further down; this fails rather than letting it
 * slip below the fold unnoticed. Any console error on any page fails it too.
 *
 * The static server and the browser launch are exported, because
 * `scripts/record-demo-video.mjs` films the same pages the same way.
 */
import { chromium } from '@playwright/test';
import { createReadStream, existsSync } from 'node:fs';
import { mkdir, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const SYSTEM_CHROMIUM = '/usr/bin/chromium';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml',
  '.webmanifest': 'application/manifest+json',
};

/**
 * Serves a built site the way Cloudflare Pages serves it: `/replay` is
 * `replay.html`, because the site is built with `format: 'file'` and no
 * trailing slashes. Byte ranges are honoured, because a browser asks for a
 * video in ranges and will not play one that is not served that way.
 */
export async function serveDirectory(root) {
  const base = resolve(root);
  const server = createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://x').pathname);
      const file = await findFile(base, pathname);
      if (!file) {
        response.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
        return;
      }
      const { size } = await stat(file);
      const type = TYPES[extname(file)] ?? 'application/octet-stream';
      const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.range ?? '');
      if (range) {
        const start = range[1] === '' ? Math.max(0, size - Number(range[2])) : Number(range[1]);
        const end = range[1] !== '' && range[2] !== '' ? Number(range[2]) : size - 1;
        response.writeHead(206, {
          'content-type': type,
          'content-length': end - start + 1,
          'content-range': `bytes ${start}-${end}/${size}`,
          'accept-ranges': 'bytes',
        });
        createReadStream(file, { start, end }).pipe(response);
        return;
      }
      response.writeHead(200, {
        'content-type': type,
        'content-length': size,
        'accept-ranges': 'bytes',
      });
      createReadStream(file).pipe(response);
    } catch (error) {
      response.writeHead(500, { 'content-type': 'text/plain' }).end(String(error));
    }
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise((done) => server.close(done)),
  };
}

async function findFile(base, pathname) {
  const wanted = normalize(join(base, pathname));
  // A request outside the served directory is answered as if it were absent.
  if (wanted !== base && !wanted.startsWith(base + sep)) return null;
  const candidates = pathname.endsWith('/')
    ? [join(wanted, 'index.html')]
    : [wanted, `${wanted}.html`, join(wanted, 'index.html')];
  for (const candidate of candidates) {
    const found = await stat(candidate).catch(() => null);
    if (found?.isFile()) return candidate;
  }
  return null;
}

/**
 * The system Chromium when there is one and this is not CI, as the e2e
 * configurations choose; Playwright's own build otherwise.
 */
export function launchChromium() {
  const useSystem = !process.env['CI'] && existsSync(SYSTEM_CHROMIUM);
  return chromium.launch(useSystem ? { executablePath: SYSTEM_CHROMIUM } : {});
}

/** Collects what a page complains about, so a capture of a broken page fails. */
export function watchProblems(page, problems) {
  page.on('pageerror', (error) => problems.push(`${page.url()} pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(`${page.url()} ${message.text()}`);
  });
}

/** Waits until the page's own fonts are in use, so nothing is photographed in a fallback face. */
export async function settle(page) {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForLoadState('networkidle');
}

async function main() {
  const { values } = parseArgs({
    options: {
      base: { type: 'string' },
      dist: { type: 'string' },
      out: { type: 'string', default: 'docs/submission-assets' },
    },
  });
  if (values.base && values.dist) throw new Error('Choose one: --base <url> or --dist <dir>.');

  const served = values.dist ? await serveDirectory(values.dist) : null;
  const base = (served?.url ?? values.base ?? 'https://rigorrun.xyz').replace(/\/$/, '');
  const out = resolve(values.out);
  await mkdir(out, { recursive: true });
  console.log(`capturing ${base} into ${out}`);

  const browser = await launchChromium();
  const problems = [];
  try {
    const desktop = await browser.newPage({
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 2,
      reducedMotion: 'reduce',
    });
    watchProblems(desktop, problems);
    await desktop.goto(`${base}/`, { waitUntil: 'load' });
    await settle(desktop);
    await desktop.screenshot({ path: join(out, 'landing-desktop.png') });
    console.log('captured landing-desktop.png');

    // The hero's first command, by the name its copy button carries.
    const command = desktop.getByRole('button', {
      name: 'Copy npx rigorrun demo to the clipboard',
    });
    const box = await command.first().boundingBox();
    if (!box || box.y + box.height > 900) {
      problems.push(
        `the hero command is not on the first screen at 1440x900 (bottom edge at ${box ? Math.round(box.y + box.height) : 'nowhere'})`,
      );
    } else {
      console.log(`hero command bottom edge at ${Math.round(box.y + box.height)}px of 900`);
    }

    const mobile = await browser.newPage({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 3,
      isMobile: true,
      hasTouch: true,
      reducedMotion: 'reduce',
    });
    watchProblems(mobile, problems);
    await mobile.goto(`${base}/`, { waitUntil: 'load' });
    await settle(mobile);
    await mobile.screenshot({ path: join(out, 'landing-mobile.png') });
    console.log('captured landing-mobile.png');

    await desktop.goto(`${base}/replay`, { waitUntil: 'load' });
    await settle(desktop);
    // On /replay the only claim-versus-reality card is the headline case's.
    const card = desktop.getByTestId('claim-reality');
    if ((await card.count()) > 0) {
      await card.first().screenshot({ path: join(out, 'replay-headline.png') });
      console.log('captured replay-headline.png');
    } else {
      console.log('no headline case on /replay in this build; replay-headline.png not written');
    }
  } finally {
    await browser.close();
    await served?.close();
  }

  if (problems.length > 0) {
    console.error('problems found while capturing:');
    for (const problem of problems) console.error(`  ${problem}`);
    process.exitCode = 1;
  } else {
    console.log('no console or page errors during capture');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main();
}
