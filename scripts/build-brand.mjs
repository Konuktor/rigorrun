#!/usr/bin/env node
/**
 * Renders every raster brand asset from the SVG sources in packages/design/logo.
 *
 * These are generated rather than drawn once and committed as mystery files, so
 * a palette change is one edit and a re-run rather than an afternoon in an
 * image editor and three files that quietly disagree about the accent. The
 * favicon used to be a data URI in index.html carrying #e7eaee while the token
 * said #e9ecf1, which is exactly the drift this prevents.
 *
 * Chromium does the rendering because it is already a devDependency for the
 * end-to-end tests, so this adds no new native toolchain.
 */
import { chromium } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
const out = join(root, 'apps', 'site', 'public');

const ACCENT = '#2A41DE';
const PAPER = '#F7F6F4';
const INK = '#0B0D10';
const FG = '#12141A';
const MUTED = '#5A616E';

const mark = (color, stroke = 3) => `
  <svg viewBox="0 0 24 24" fill="none" style="width:100%;height:100%">
    <path d="M5.5 4.25V19.75" stroke="${color}" stroke-width="${stroke}" stroke-linecap="round"/>
    <path d="M5.5 9H12.5" stroke="${color}" stroke-width="${stroke}" stroke-linecap="round"/>
    <path d="M5.5 15H19" stroke="${color}" stroke-width="${stroke}" stroke-linecap="round"/>
  </svg>`;

const squareIcon = (size) => `
  <div style="width:${size}px;height:${size}px;background:${ACCENT};border-radius:${Math.round(size * 0.22)}px;display:grid;place-items:center">
    <div style="width:${Math.round(size * 0.62)}px;height:${Math.round(size * 0.62)}px">${mark('#FFFFFF', 3.2)}</div>
  </div>`;

async function main() {
  await mkdir(out, { recursive: true });
  const fontCss = await fontFace();
  const browser = await chromium.launch();

  const shot = async (html, width, height, file, scale = 1) => {
    const page = await browser.newPage({
      viewport: { width, height },
      deviceScaleFactor: scale,
    });
    await page.setContent(
      `<style>${fontCss}*{margin:0;padding:0;box-sizing:border-box}body{width:${width}px;height:${height}px;overflow:hidden}</style>${html}`,
    );
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(120);
    await page.screenshot({ path: join(out, file), omitBackground: true });
    await page.close();
    console.log(`  ${file}`);
  };

  console.log('icons');
  for (const size of [16, 32, 180, 192, 512]) {
    const name =
      size === 180 ? 'apple-touch-icon.png' : size === 16 || size === 32 ? `favicon-${size}.png` : `icon-${size}.png`;
    await shot(squareIcon(size), size, size, name);
  }

  // A .ico so a browser that ignores the SVG still gets the mark rather than a
  // default globe. One 32px frame is enough; nothing asks for more.
  await writeFile(join(out, 'favicon.ico'), await ico(join(out, 'favicon-32.png')));
  console.log('  favicon.ico');

  console.log('share cards');
  await shot(card(), 1200, 630, 'og.png');

  await browser.close();
}

/** The share card. Typography only — no stock gradient, no fake dashboard. */
function card() {
  return `<div style="width:1200px;height:630px;background:${PAPER};color:${FG};
      font-family:'Instrument Sans',Arial,sans-serif;padding:72px;display:flex;flex-direction:column;
      justify-content:space-between;border-bottom:10px solid ${ACCENT}">
    <div style="display:flex;align-items:center;gap:14px">
      <div style="width:40px;height:40px">${mark(ACCENT, 3)}</div>
      <span style="font-size:28px;font-weight:600;letter-spacing:-0.02em">RigorRun</span>
    </div>
    <div>
      <p style="font-size:66px;line-height:1.06;letter-spacing:-0.035em;font-weight:500;max-width:20ch">
        Your agent said it worked.
        <span style="color:${MUTED}">RigorRun checks what it did.</span>
      </p>
    </div>
    <div style="display:flex;align-items:center;justify-content:space-between;font-size:22px;color:${MUTED}">
      <span style="font-family:'Geist Mono',monospace;color:${FG};background:${INK};color:#E9ECF1;
        padding:12px 20px;border-radius:10px">$ npx rigorrun</span>
      <span>Acceptance testing for AI agents</span>
    </div>
  </div>`;
}

/** Inline the real faces so the card does not render in a fallback. */
async function fontFace() {
  const dir = join(root, 'packages', 'design', 'fonts');
  const [sans, mono] = await Promise.all([
    readFile(join(dir, 'instrument-sans-latin.woff2')),
    readFile(join(dir, 'geist-mono-latin.woff2')),
  ]);
  return (
    `@font-face{font-family:'Instrument Sans';font-weight:400 700;src:url(data:font/woff2;base64,${sans.toString('base64')}) format('woff2')}` +
    `@font-face{font-family:'Geist Mono';font-weight:400 600;src:url(data:font/woff2;base64,${mono.toString('base64')}) format('woff2')}`
  );
}

/** Minimal single-image ICO wrapper around a PNG frame. */
async function ico(pngPath) {
  const png = await readFile(pngPath);
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(1, 4); // one image
  const entry = Buffer.alloc(16);
  entry.writeUInt8(32, 0); // width
  entry.writeUInt8(32, 1); // height
  entry.writeUInt8(0, 2); // palette
  entry.writeUInt8(0, 3);
  entry.writeUInt16LE(1, 4); // planes
  entry.writeUInt16LE(32, 6); // bpp
  entry.writeUInt32LE(png.length, 8);
  entry.writeUInt32LE(header.length + entry.length, 12);
  return Buffer.concat([header, entry, png]);
}

await main();
