#!/usr/bin/env node
/**
 * The demo video and GIF, made from a recording rather than typed.
 *
 *   node scripts/record-demo-video.mjs [--replay <file>] [--out <dir>] [--keep-work]
 *   pnpm video [--replay <file>] [--out <dir>]
 *
 * Three scenes, just under a minute, 1280x720, no sound:
 *
 *  1. A terminal. The command is typed, and what follows is what
 *     `pnpm rigorrun demo --replay <file>` printed when this script ran it — under
 *     a pseudo-terminal, so it prints the colours it prints for a person. The
 *     output is revealed a paragraph at a time and the terminal holds on the
 *     headline case, but not a character of it is written here.
 *  2. The site's /replay page, built from the same recording, scrolled to the
 *     headline case: what the agent said, beside what the system shows.
 *  3. A closing card: `npx rigorrun stripe init` and rigorrun.xyz.
 *
 * Every frame is a screenshot of a real page, taken at a time this script sets,
 * so the video does not depend on how fast the machine making it is. Scenes
 * are encoded losslessly, joined with short cross-fades, and only then encoded
 * for delivery:
 *
 *   demo.mp4         H.264, for the landing page; must stay under 8 MB.
 *   demo.webm        VP9, offered first to browsers built without H.264.
 *   demo.gif         960 px wide, 12 fps, palette-optimised, for the README; at most 6 MB.
 *   demo-poster.png  The terminal holding on the headline case, at full resolution.
 *
 * `--replay` defaults to the flagship recording, fixtures/replays/stripe-replay.json,
 * and the output to apps/site/public/media/, where the landing page looks for it.
 * A recording marked as a pilot is not evidence: it is labelled as one in every
 * scene, and this script refuses to write it into the site.
 *
 * Needs ffmpeg on the PATH (or in $FFMPEG) and Playwright's Chromium.
 */
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { launchChromium, serveDirectory, settle, watchProblems } from './capture-assets.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FLAGSHIP = join(ROOT, 'fixtures/replays/stripe-replay.json');
const SITE_MEDIA = join(ROOT, 'apps/site/public/media');
const DESIGN = join(ROOT, 'packages/design');
const FFMPEG = process.env['FFMPEG'] ?? 'ffmpeg';

const WIDTH = 1280;
const HEIGHT = 720;
const FPS = 30;
/** How much larger than 1:1 the site is filmed. 1280 / 1.25 = 1024, the site's desktop breakpoint. */
const SITE_ZOOM = 1.25;
/** Seconds of cross-fade between scenes. */
const FADE = 0.5;
const MP4_LIMIT = 8 * 1024 * 1024;
const GIF_LIMIT = 6 * 1024 * 1024;
/** Tried in order until the GIF fits under its limit. */
const GIF_ATTEMPTS = [
  { colors: 256, fps: 12 },
  { colors: 128, fps: 12 },
  { colors: 64, fps: 12 },
  { colors: 64, fps: 10 },
];

const ESC = String.fromCharCode(27);

// ------------------------------------------------------------------ the replay

/**
 * What `rigorrun demo` printed for this recording, with its colours.
 *
 * The CLI colours its output only when stdout is a terminal, so it is run under
 * `script`, which gives it one. Where `script` is missing it is run on a pipe
 * instead and the video is monochrome, which is still exactly what it printed.
 */
function runDemo(replayPath) {
  const command = `pnpm --silent rigorrun demo --replay ${shellQuote(replayPath)}`;
  const env = { ...process.env, TERM: 'xterm-256color' };
  delete env['NO_COLOR'];
  const hasScript = spawnSync('script', ['--version'], { stdio: 'ignore' }).error === undefined;
  const args = !hasScript
    ? null
    : process.platform === 'linux'
      ? ['-qec', command, '/dev/null']
      : ['-q', '/dev/null', 'sh', '-c', command];
  if (!args) console.warn('`script` is not available; the terminal scene will have no colour.');
  const result = args
    ? spawnSync('script', args, { cwd: ROOT, env, encoding: 'utf8', maxBuffer: 1 << 24 })
    : spawnSync('sh', ['-c', command], { cwd: ROOT, env, encoding: 'utf8', maxBuffer: 1 << 24 });
  if (result.status !== 0) {
    throw new Error(`\`${command}\` exited ${result.status}:\n${result.stdout}${result.stderr}`);
  }
  return result.stdout;
}

function shellQuote(text) {
  return `'${text.replaceAll("'", `'\\''`)}'`;
}

/** Terminal output as lines of styled runs. Only SGR (colour and weight) is understood. */
function parseAnsi(output) {
  const sgr = new RegExp(`${ESC}\\[([0-9;]*)m`, 'g');
  const otherControl = new RegExp(`${ESC}\\[[0-9;?]*[A-Za-ln-z]`, 'g');
  const style = { bold: false, dim: false, color: null };
  const lines = output
    .replaceAll('\r', '')
    .replace(otherControl, '')
    .split('\n')
    .map((raw) => {
      const runs = [];
      let last = 0;
      const push = (text) => {
        if (text) runs.push({ text, ...style });
      };
      for (const match of raw.matchAll(sgr)) {
        push(raw.slice(last, match.index));
        for (const code of (match[1] || '0').split(';').map(Number)) applySgr(style, code);
        last = match.index + match[0].length;
      }
      push(raw.slice(last));
      return { runs, text: runs.map((run) => run.text).join('') };
    });
  while (lines.length > 0 && lines.at(-1).text.trim() === '') lines.pop();
  return lines;
}

const SGR_COLORS = { 31: 'fail', 32: 'pass', 33: 'warn', 34: 'accent', 36: 'accent', 90: 'muted' };

function applySgr(style, code) {
  if (code === 0) Object.assign(style, { bold: false, dim: false, color: null });
  else if (code === 1) style.bold = true;
  else if (code === 2) style.dim = true;
  else if (code === 22) Object.assign(style, { bold: false, dim: false });
  else if (code === 39) style.color = null;
  else if (code in SGR_COLORS) style.color = SGR_COLORS[code];
}

// ------------------------------------------------------- the terminal's timing

/**
 * How long each paragraph of output takes to appear, a line at a time, and how
 * long the terminal then holds still. The headline case is where the video
 * stops to be read; everything else moves.
 */
const PACE = { intro: 0.07, headline: 0.15, claim: 0.28, matrix: 0.14, other: 0.08 };
const HOLD = { intro: 1.8, headline: 2.4, claim: 8, matrix: 4.5, last: 2.8 };

/** Which part of the replay a paragraph is, recognised by the labels the CLI prints. */
function roleOf(paragraph, index, lines) {
  const texts = paragraph.map((i) => lines[i].text.trimStart());
  if (texts.some((text) => text.startsWith('The agent said'))) return 'claim';
  if (texts.some((text) => text.startsWith('›'))) return 'matrix';
  if (texts.find((text) => text !== '')?.startsWith('The headline')) return 'headline';
  return index === 0 ? 'intro' : 'other';
}

/** The rows a hold points at: the claim through the verdict, or the headline's row in the matrix. */
function markedRows(role, paragraph, lines) {
  const starts = (prefix) => paragraph.find((i) => lines[i].text.trimStart().startsWith(prefix));
  if (role === 'matrix') return paragraph.filter((i) => lines[i].text.startsWith('›'));
  const from = starts('The agent said');
  const to = starts('Verdict') ?? paragraph.at(-1);
  return paragraph.filter((i) => i >= from && i <= to);
}

function terminalTimeline(lines, command) {
  const timeline = { typed: [], enter: 0, shown: [], prompt: 0, marks: [], poster: 0, end: 0 };
  let now = 0.9;
  // A typist's rhythm, deterministic so that every run makes the same video.
  for (let index = 0; index < command.length; index += 1) {
    now += 0.055 + ((index * 7) % 5) * 0.012;
    timeline.typed.push(now);
  }
  now += 0.55;
  timeline.enter = now;
  now += 0.35;

  // A paragraph is a run of non-empty lines, with the blank lines before it.
  const paragraphs = [];
  let current = [];
  for (const [index, entry] of lines.entries()) {
    current.push(index);
    if (entry.text.trim() !== '' && lines[index + 1]?.text.trim() === '') {
      paragraphs.push(current);
      current = [];
    }
  }
  if (current.length > 0) paragraphs.push(current);

  for (const [index, paragraph] of paragraphs.entries()) {
    const role = roleOf(paragraph, index, lines);
    for (const line of paragraph) {
      timeline.shown[line] = now;
      if (lines[line].text.trim() !== '') now += PACE[role] ?? PACE.other;
    }
    const last = index === paragraphs.length - 1;
    if (last) timeline.prompt = now;
    const words = paragraph.reduce((sum, i) => sum + lines[i].text.split(/\s+/).length, 0);
    const hold = last ? HOLD.last : (HOLD[role] ?? Math.min(2.2, Math.max(0.6, words * 0.08)));
    if (role === 'claim' || role === 'matrix') {
      const rows = markedRows(role, paragraph, lines);
      if (rows.length > 0) timeline.marks.push({ from: now + 0.25, to: now + hold, rows });
      if (role === 'claim') timeline.poster = now + hold * 0.6;
    }
    now += hold;
  }
  timeline.end = now;
  // No headline case (nothing failed): the poster is the finished run instead.
  if (timeline.poster === 0) timeline.poster = now - 0.5;
  return timeline;
}

// ------------------------------------------------------------- the scene pages

/**
 * The design system's tokens as plain CSS. `tokens.css` is written for
 * Tailwind, whose `@theme` block a browser ignores; its declarations are
 * lifted out and declared on `:root` and on every themed element — the same
 * re-declaration site.css makes, so that an ink element resolves ink values.
 */
async function designCss() {
  const tokens = await readFile(join(DESIGN, 'src/tokens.css'), 'utf8');
  const fonts = await readFile(join(DESIGN, 'src/fonts.css'), 'utf8');
  const theme = /@theme\s*\{([\s\S]*?)\n\}/.exec(tokens)?.[1];
  if (!theme) throw new Error('packages/design/src/tokens.css has no @theme block.');
  const rest = tokens.replace(/@theme\s*\{[\s\S]*?\n\}/, '');
  return `${fonts}\n${rest}\n:root, [data-theme] {${theme}\n}\n`;
}

const MARK = `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
  <path d="M5.5 4.25V19.75" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>
  <path d="M5.5 9H12.5" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>
  <path d="M5.5 15H19" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>
</svg>`;

const PILOT_LABEL = 'Pilot recording · not evidence';

function escapeHtml(text) {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

const PAGE_BASE = `
  html, body { margin: 0; width: ${WIDTH}px; height: ${HEIGHT}px; overflow: hidden; }
  body {
    background: var(--color-canvas); color: var(--color-fg);
    font-family: var(--font-sans); -webkit-font-smoothing: antialiased;
  }
  [hidden] { display: none !important; }
  .pilot {
    border: 1px solid var(--color-warn-line); background: var(--color-warn-bg);
    color: var(--color-warn); border-radius: var(--radius-pill);
    font: 600 12px/1 var(--font-sans); letter-spacing: 0.02em; padding: 5px 10px;
  }
`;

function terminalPage({ lines, command, timeline, pilot }) {
  const body = lines
    .map((entry, index) => {
      const runs = entry.runs
        .map((run) => {
          const classes = [run.bold && 'b', run.dim && 'd', run.color && `c-${run.color}`].filter(
            Boolean,
          );
          const text = escapeHtml(run.text);
          return classes.length > 0 ? `<span class="${classes.join(' ')}">${text}</span>` : text;
        })
        .join('');
      return `<div class="line" data-line="${index}" hidden>${runs || ' '}</div>`;
    })
    .join('\n');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>terminal</title>
<link rel="stylesheet" href="design.css">
<style>${PAGE_BASE}
  .stage { width: ${WIDTH}px; height: ${HEIGHT}px; display: grid; place-items: center; }
  .lift { border-radius: var(--radius-panel); box-shadow: var(--shadow-lift); }
  .term {
    font-family: var(--font-mono); font-size: 18px;
    width: calc(100ch + 58px); height: 676px; display: flex; flex-direction: column;
    background: var(--color-canvas); border: 1px solid var(--color-line-strong);
    border-radius: var(--radius-panel); overflow: hidden;
  }
  .bar {
    flex: none; height: 36px; display: grid; grid-template-columns: 1fr auto 1fr;
    align-items: center; padding: 0 14px; background: var(--color-raised);
    border-bottom: 1px solid var(--color-line);
  }
  .dots { display: flex; gap: 7px; }
  .dots i { width: 11px; height: 11px; border-radius: 50%; background: var(--color-line-strong); }
  .title { font: 500 13px/1 var(--font-sans); color: var(--color-muted); }
  .bar .pilot { justify-self: end; }
  .screen { flex: 1; overflow: hidden; padding: 14px 28px; }
  .scroll {
    font: 400 18px/25px var(--font-mono); color: var(--color-fg);
    font-variant-ligatures: none; font-variant-numeric: tabular-nums;
  }
  /* Each line keeps its own spacing; the markup between lines is not output. */
  .line { margin: 0 -28px; padding: 0 28px; min-height: 25px; white-space: pre-wrap; }
  .line.mark { background: var(--color-accent-bg); box-shadow: inset 3px 0 0 var(--color-accent); }
  .prompt { color: var(--color-accent); }
  .caret {
    display: inline-block; width: 1ch; height: 21px; vertical-align: -4px;
    background: var(--color-fg); visibility: hidden;
  }
  .b { font-weight: 600; }
  .d { opacity: 0.72; }
  .c-muted { color: var(--color-muted); }
  .c-pass { color: var(--color-pass); }
  .c-fail { color: var(--color-fail); }
  .c-warn { color: var(--color-warn); }
  .c-accent { color: var(--color-accent); }
</style></head>
<body><div class="stage"><div class="lift"><div class="term" data-theme="ink">
  <div class="bar"><span class="dots"><i></i><i></i><i></i></span><span class="title">Terminal</span>
  ${pilot ? `<span class="pilot">${PILOT_LABEL}</span>` : '<span></span>'}</div>
  <div class="screen"><div class="scroll" id="scroll">
<div class="line"><span class="prompt">$ </span><span id="typed"></span><span class="caret" id="caret"></span></div>
${body}
<div class="line" id="prompt" hidden><span class="prompt">$ </span><span class="caret" id="caret2"></span></div>
  </div></div>
</div></div></div>
<script>
  const COMMAND = ${JSON.stringify(command)};
  const T = ${JSON.stringify(timeline)};
  const lines = [...document.querySelectorAll('[data-line]')];
  const screen = document.querySelector('.screen');
  const scroll = document.getElementById('scroll');
  const typed = document.getElementById('typed');
  const caret = document.getElementById('caret');
  const caret2 = document.getElementById('caret2');
  const prompt = document.getElementById('prompt');
  // Everything on screen is a function of t, so a frame can be asked for in any order.
  window.__frame = (t) => {
    const count = T.typed.filter((at) => at <= t).length;
    typed.textContent = COMMAND.slice(0, count);
    let shown = 0;
    lines.forEach((line, index) => {
      line.hidden = !(T.shown[index] <= t);
      if (!line.hidden) shown += 1;
    });
    prompt.hidden = t < T.prompt;
    const mark = T.marks.findIndex((m) => t >= m.from && t < m.to);
    lines.forEach((line, index) => {
      line.classList.toggle('mark', mark >= 0 && T.marks[mark].rows.includes(index));
    });
    const typing = count > 0 && t < T.enter;
    const blink = Math.floor(t / 0.53) % 2 === 0;
    const first = t < T.enter && (typing || blink);
    const last = t >= T.prompt && blink;
    caret.style.visibility = first ? 'visible' : 'hidden';
    caret2.style.visibility = last ? 'visible' : 'hidden';
    const inner = screen.clientHeight - 28;
    const over = Math.max(0, scroll.offsetHeight - inner);
    scroll.style.transform = 'translateY(' + -over + 'px)';
    return [count, shown, mark, first, last, over].join('|');
  };
</script></body></html>`;
}

/**
 * The closing card. Its words are the landing page's own: the second command,
 * what it is for, and where to read more.
 */
function closingPage({ pilot }) {
  const at = [0.15, 0.45, 0.8, 1.15, 1.5];
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>closing</title>
<link rel="stylesheet" href="design.css">
<style>${PAGE_BASE}
  .stage {
    width: ${WIDTH}px; height: ${HEIGHT}px; display: flex; flex-direction: column;
    align-items: center; justify-content: center; text-align: center; position: relative;
  }
  .logo {
    display: inline-flex; align-items: center; gap: 12px;
    font: 600 26px/1 var(--font-sans); letter-spacing: -0.02em; color: var(--color-fg);
  }
  .logo svg { width: 36px; height: 36px; color: var(--color-accent); }
  h1 {
    margin: 44px 0 0; font-weight: 500; font-size: 52px; line-height: 1.08;
    letter-spacing: -0.03em;
  }
  .command {
    margin-top: 36px; display: inline-flex; align-items: center;
    background: var(--color-canvas); border: 1px solid var(--color-line);
    border-radius: var(--radius-control); padding: 18px 30px;
    font: 400 34px/1 var(--font-mono); color: var(--color-fg);
  }
  .command .prompt { color: var(--color-muted); }
  .sub { margin: 26px 0 0; font-size: 21px; line-height: 1.5; color: var(--color-secondary); }
  .url { margin: 46px 0 0; font: 500 26px/1 var(--font-sans); color: var(--color-accent); }
  .pilot { position: absolute; top: 24px; right: 24px; }
  [data-at] { will-change: opacity, transform; }
</style></head>
<body><div class="stage">
  ${pilot ? `<span class="pilot">${PILOT_LABEL}</span>` : ''}
  <div class="logo" data-at="${at[0]}">${MARK}RigorRun</div>
  <h1 data-at="${at[1]}">Then your own agent, unchanged.</h1>
  <div class="command" data-theme="ink" data-at="${at[2]}"><span class="prompt">$&nbsp;</span>npx rigorrun stripe init</div>
  <p class="sub" data-at="${at[3]}">On a local Stripe twin or your test mode.<br>Open source, runs on your machine, no account.</p>
  <p class="url" data-at="${at[4]}">rigorrun.xyz</p>
</div>
<script>
  const parts = [...document.querySelectorAll('[data-at]')];
  // A short rise into place, in twelve steps so that held frames repeat exactly.
  window.__frame = (t) => parts.map((part) => {
    const raw = Math.min(1, Math.max(0, (t - Number(part.dataset.at)) / 0.45));
    const step = Math.round((1 - Math.pow(1 - raw, 3)) * 12) / 12;
    part.style.opacity = String(step);
    part.style.transform = 'translateY(' + (1 - step) * 10 + 'px)';
    return step;
  }).join('|');
</script></body></html>`;
}

// ------------------------------------------------------------------ filming

/** A lossless encoder fed PNG frames on stdin. */
function openEncoder(path) {
  const ffmpeg = spawn(
    FFMPEG,
    [
      ...['-hide_banner', '-loglevel', 'error', '-y'],
      ...['-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'png', '-i', '-'],
      ...['-c:v', 'libx264rgb', '-preset', 'ultrafast', '-qp', '0', path],
    ],
    { stdio: ['pipe', 'inherit', 'inherit'] },
  );
  let failure = null;
  ffmpeg.stdin.on('error', (error) => (failure = error));
  const closed = new Promise((done, fail) => {
    ffmpeg.on('error', fail);
    ffmpeg.on('close', (code) =>
      code === 0 ? done() : fail(new Error(`ffmpeg exited ${code} writing ${path}`)),
    );
  });
  return {
    async write(frame) {
      if (failure) throw failure;
      if (!ffmpeg.stdin.write(frame)) await once(ffmpeg.stdin, 'drain');
    },
    async close() {
      ffmpeg.stdin.end();
      await closed;
    },
  };
}

/**
 * Films a scene: for every frame, sets the page to that moment and takes a
 * screenshot — only when the page says something changed, since most of a
 * terminal's frames are the same as the one before.
 */
async function film(page, { seconds, frame, path, keep }) {
  const encoder = openEncoder(path);
  const count = Math.round(seconds * FPS);
  let key;
  let shot;
  for (let index = 0; index < count; index += 1) {
    const t = index / FPS;
    const next = await frame(t);
    if (shot === undefined || next !== key) {
      // Two animation frames, so the change has been painted. Without them a
      // change that needs no layout, such as a background, can miss the shot.
      await page.evaluate(
        () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
      );
      shot = await page.screenshot({ type: 'png' });
      key = next;
    }
    keep?.(t, shot);
    await encoder.write(shot);
  }
  await encoder.close();
  return count / FPS;
}

const easeInOut = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);

/** Scene 2: /replay, from the top down to the headline case, which it then holds. */
async function filmReplayPage(page, base, path, pilot) {
  await page.goto(`${base}/replay`, { waitUntil: 'load' });
  await settle(page);
  if (pilot) {
    await page.evaluate((label) => {
      const badge = document.createElement('span');
      badge.className = 'rr-video-pilot';
      badge.textContent = label;
      Object.assign(badge.style, {
        // Bottom left, where the page's left column is empty beside the card.
        position: 'fixed',
        bottom: '16px',
        left: '16px',
        zIndex: '999',
        padding: '5px 10px',
        borderRadius: '999px',
        font: '600 12px/1 var(--font-sans)',
        color: 'var(--color-warn)',
        background: 'color-mix(in oklab, var(--color-canvas) 80%, var(--color-warn) 20%)',
        border: '1px solid var(--color-warn-line)',
      });
      document.body.append(badge);
    }, PILOT_LABEL);
  }
  // The headline case's card when there is one; the section that says there
  // is none otherwise.
  const target = await page.evaluate(() => {
    const nav = document.querySelector('header')?.getBoundingClientRect().height ?? 0;
    const card = document.querySelector('[data-testid="claim-reality"]');
    const heading = [...document.querySelectorAll('h2')].find((h) =>
      h.textContent?.includes('The headline case'),
    );
    const element = card ?? heading?.closest('section');
    if (!element) return null;
    const box = element.getBoundingClientRect();
    const room = window.innerHeight - nav;
    const top = box.top + window.scrollY;
    const fits = box.height <= room - 24;
    return {
      first: Math.max(0, top - nav - (fits ? (room - box.height) / 2 : 12)),
      // A card taller than the screen is held at its top, then at its foot.
      second: fits ? null : top + box.height - window.innerHeight + 16,
    };
  });
  const stops = target ? [target.first, ...(target.second === null ? [] : [target.second])] : [];
  const scenes = [{ y: 0, hold: 2.6 }];
  for (const [index, y] of stops.entries()) {
    scenes.push({ y, move: index === 0 ? 1.8 : 1.4, hold: index === stops.length - 1 ? 7.5 : 4 });
  }
  const at = (t) => {
    let start = 0;
    let y = scenes[0].y;
    for (const step of scenes) {
      if (step.move) {
        if (t < start + step.move) {
          return y + (step.y - y) * easeInOut((t - start) / step.move);
        }
        start += step.move;
      }
      y = step.y;
      if (t < start + step.hold) return y;
      start += step.hold;
    }
    return y;
  };
  const seconds = scenes.reduce((sum, step) => sum + (step.move ?? 0) + step.hold, 0);
  return film(page, {
    seconds,
    path,
    frame: async (t) => {
      const y = Math.round(at(t));
      await page.evaluate((top) => window.scrollTo({ top, behavior: 'instant' }), y);
      return String(y);
    },
  });
}

// ------------------------------------------------------------------ encoding

function ffmpeg(args) {
  const result = spawnSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', ...args], {
    stdio: 'inherit',
  });
  if (result.status !== 0) throw new Error(`ffmpeg ${args.join(' ')} exited ${result.status}`);
}

async function sizeOf(path) {
  return (await stat(path)).size;
}

/** A path relative to the repository when it is inside it. */
function shown(path) {
  const inside = relative(ROOT, path);
  return inside.startsWith('..') ? path : inside;
}

const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(2)} MB`;

// ------------------------------------------------------------------ main

async function main() {
  const { values } = parseArgs({
    options: {
      replay: { type: 'string', default: FLAGSHIP },
      out: { type: 'string', default: SITE_MEDIA },
      'keep-work': { type: 'boolean', default: false },
    },
  });
  const replayPath = resolve(values.replay);
  const out = resolve(values.out);
  if (!existsSync(replayPath)) {
    throw new Error(
      `No recording at ${replayPath}. The flagship recording is made under ` +
        'reports/flagship-demo-2026-10/PREREGISTRATION.md; pass --replay <file> to film another.',
    );
  }
  const replay = JSON.parse(await readFile(replayPath, 'utf8'));
  const pilot = replay.pilot === true;
  if (pilot && out === SITE_MEDIA) {
    throw new Error(
      `${shown(replayPath)} is a pilot recording, which is not evidence; ` +
        'the site does not publish a video of one. Pass --out <dir> to film it somewhere else.',
    );
  }
  // What a person types to see this replay: plain `demo` replays the flagship.
  const command =
    replayPath === FLAGSHIP
      ? 'npx rigorrun demo'
      : `npx rigorrun demo --replay ${basename(replayPath)}`;

  const work = await mkdtemp(join(tmpdir(), 'rigorrun-video-'));
  const site = join(work, 'site');
  console.log(`recording ${shown(replayPath)}${pilot ? ' (pilot)' : ''}`);
  console.log(`working in ${work}`);

  // The terminal's text: the CLI's own output for this recording.
  const lines = parseAnsi(runDemo(replayPath));
  console.log(`rigorrun demo printed ${lines.length} lines`);
  const timeline = terminalTimeline(lines, command);

  // The site, built from the same recording, into a scratch directory. The
  // flagship is what the site shows anyway; any other file is named to it.
  const env = { ...process.env };
  delete env['RIGORRUN_REPLAY_FILE'];
  if (replayPath !== FLAGSHIP) env['RIGORRUN_REPLAY_FILE'] = replayPath;
  const build = spawnSync(
    'pnpm',
    ['-F', '@rigorrun/site', 'exec', 'astro', 'build', '--outDir', site],
    { cwd: ROOT, env, stdio: ['ignore', 'ignore', 'inherit'] },
  );
  if (build.status !== 0) throw new Error(`The site build exited ${build.status}.`);

  const scenes = join(site, '__video');
  await mkdir(scenes, { recursive: true });
  await writeFile(join(scenes, 'design.css'), await designCss());
  await writeFile(join(scenes, 'terminal.html'), terminalPage({ lines, command, timeline, pilot }));
  await writeFile(join(scenes, 'closing.html'), closingPage({ pilot }));

  const served = await serveDirectory(site);
  const browser = await launchChromium();
  const problems = [];
  let poster;
  const durations = [];
  try {
    const page = await browser.newPage({
      viewport: { width: WIDTH, height: HEIGHT },
      deviceScaleFactor: 1,
      reducedMotion: 'reduce',
    });
    watchProblems(page, problems);

    await page.goto(`${served.url}/__video/terminal.html`, { waitUntil: 'load' });
    await settle(page);
    durations.push(
      await film(page, {
        seconds: timeline.end,
        path: join(work, 'scene-1.mkv'),
        frame: (t) => page.evaluate((at) => window.__frame(at), t),
        keep: (t, shot) => {
          if (poster === undefined && t >= timeline.poster) poster = shot;
        },
      }),
    );
    console.log(`scene 1, the terminal: ${durations[0].toFixed(1)} s`);

    // The site at 1.25x: a 1024 px viewport is still the desktop layout, and
    // its smallest text is then large enough to read in the GIF.
    const sitePage = await browser.newPage({
      viewport: { width: WIDTH / SITE_ZOOM, height: HEIGHT / SITE_ZOOM },
      deviceScaleFactor: SITE_ZOOM,
      reducedMotion: 'reduce',
    });
    watchProblems(sitePage, problems);
    durations.push(await filmReplayPage(sitePage, served.url, join(work, 'scene-2.mkv'), pilot));
    console.log(`scene 2, /replay: ${durations[1].toFixed(1)} s`);

    await page.goto(`${served.url}/__video/closing.html`, { waitUntil: 'load' });
    await settle(page);
    durations.push(
      await film(page, {
        seconds: 5.5,
        path: join(work, 'scene-3.mkv'),
        frame: (t) => page.evaluate((at) => window.__frame(at), t),
      }),
    );
    console.log(`scene 3, the closing card: ${durations[2].toFixed(1)} s`);
  } finally {
    await browser.close();
    await served.close();
  }
  if (problems.length > 0) {
    throw new Error(`The pages being filmed reported problems:\n  ${problems.join('\n  ')}`);
  }

  // Joined with cross-fades, still lossless; every delivery format is made from this.
  const master = join(work, 'master.mkv');
  const firstFade = durations[0] - FADE;
  const secondFade = durations[0] + durations[1] - 2 * FADE;
  ffmpeg([
    ...['-i', join(work, 'scene-1.mkv'), '-i', join(work, 'scene-2.mkv')],
    ...['-i', join(work, 'scene-3.mkv')],
    '-filter_complex',
    `[0:v][1:v]xfade=transition=fade:duration=${FADE}:offset=${firstFade.toFixed(3)}[a];` +
      `[a][2:v]xfade=transition=fade:duration=${FADE}:offset=${secondFade.toFixed(3)}[v]`,
    ...['-map', '[v]', '-c:v', 'libx264rgb', '-preset', 'ultrafast', '-qp', '0', master],
  ]);

  await mkdir(out, { recursive: true });
  const mp4 = join(out, 'demo.mp4');
  const webm = join(out, 'demo.webm');
  const gif = join(out, 'demo.gif');
  const posterPath = join(out, 'demo-poster.png');
  const bt709 = ['-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709'];
  const toYuv = 'scale=out_color_matrix=bt709:out_range=tv,format=yuv420p';

  ffmpeg([
    ...['-i', master, '-vf', toYuv, '-an'],
    ...['-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-profile:v', 'high'],
    ...bt709,
    ...['-movflags', '+faststart', mp4],
  ]);
  ffmpeg([
    ...['-i', master, '-vf', toYuv, '-an'],
    ...['-c:v', 'libvpx-vp9', '-crf', '32', '-b:v', '0', '-row-mt', '1'],
    ...['-deadline', 'good', '-cpu-used', '2'],
    ...bt709,
    webm,
  ]);
  let gifSettings;
  for (const attempt of GIF_ATTEMPTS) {
    // No dithering: text stays crisp, and a flat page needs few colours.
    ffmpeg([
      ...['-i', master, '-filter_complex'],
      `fps=${attempt.fps},scale=960:-1:flags=lanczos,split[a][b];` +
        `[a]palettegen=max_colors=${attempt.colors}:stats_mode=full[p];` +
        `[b][p]paletteuse=dither=none:diff_mode=rectangle`,
      gif,
    ]);
    gifSettings = attempt;
    if ((await sizeOf(gif)) <= GIF_LIMIT) break;
  }
  if (!poster) throw new Error('No frame was kept for the poster.');
  await writeFile(posterPath, poster);

  const sizes = {
    mp4: await sizeOf(mp4),
    webm: await sizeOf(webm),
    gif: await sizeOf(gif),
    poster: await sizeOf(posterPath),
  };
  const total = durations.reduce((a, b) => a + b, 0) - FADE * (durations.length - 1);
  console.log(`\n${total.toFixed(1)} s at ${WIDTH}x${HEIGHT}, ${FPS} fps, into ${out}`);
  console.log(`  demo.mp4         ${mb(sizes.mp4)}`);
  console.log(`  demo.webm        ${mb(sizes.webm)}`);
  console.log(
    `  demo.gif         ${mb(sizes.gif)}  (${gifSettings.colors} colours, ${gifSettings.fps} fps)`,
  );
  console.log(`  demo-poster.png  ${mb(sizes.poster)}`);

  if (values['keep-work']) {
    console.log(`kept ${work}`);
  } else {
    await rm(work, { recursive: true, force: true });
  }
  const over = [];
  if (sizes.mp4 >= MP4_LIMIT) over.push(`demo.mp4 is ${mb(sizes.mp4)}; the limit is 8 MB`);
  if (sizes.gif > GIF_LIMIT) over.push(`demo.gif is ${mb(sizes.gif)}; the limit is 6 MB`);
  if (over.length > 0) throw new Error(over.join('\n'));
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
