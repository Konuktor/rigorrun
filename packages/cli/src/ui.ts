/**
 * Terminal output helpers. Colour is opt-out via NO_COLOR and is disabled
 * automatically when stdout is not a TTY, so piped output stays clean.
 */
const CSI = `${String.fromCharCode(27)}[`;

const useColor =
  !process.env['NO_COLOR'] && process.stdout.isTTY === true && process.env['TERM'] !== 'dumb';

const wrap = (code: string) => (text: string) =>
  useColor ? `${CSI}${code}m${text}${CSI}0m` : text;

export const c = {
  bold: wrap('1'),
  dim: wrap('2'),
  red: wrap('31'),
  green: wrap('32'),
  yellow: wrap('33'),
  blue: wrap('34'),
  cyan: wrap('36'),
  grey: wrap('90'),
};

export function heading(text: string): void {
  process.stdout.write(`\n${c.bold(text)}\n`);
}

export function line(text = ''): void {
  process.stdout.write(`${text}\n`);
}

export function errorLine(text: string): void {
  process.stderr.write(`${c.red('error')} ${text}\n`);
}

export function warnLine(text: string): void {
  process.stderr.write(`${c.yellow('warn')}  ${text}\n`);
}

/** Fixed-width table with right-aligned numeric columns. */
export function table(headers: string[], rows: string[][], numeric: number[] = []): void {
  const widths = headers.map((header, i) =>
    Math.max(header.length, ...rows.map((row) => stripAnsi(row[i] ?? '').length)),
  );
  const pad = (text: string, width: number, right: boolean) => {
    const gap = width - stripAnsi(text).length;
    return right ? ' '.repeat(Math.max(0, gap)) + text : text + ' '.repeat(Math.max(0, gap));
  };

  line(c.grey(headers.map((h, i) => pad(h, widths[i]!, numeric.includes(i))).join('  ')));
  line(c.grey(widths.map((w) => '-'.repeat(w)).join('  ')));
  for (const row of rows) {
    line(row.map((cell, i) => pad(cell ?? '', widths[i]!, numeric.includes(i))).join('  '));
  }
}

function stripAnsi(text: string): string {
  return text
    .split(CSI)
    .map((part, i) => (i === 0 ? part : part.replace(/^\d+m/, '')))
    .join('');
}

export function fmtMs(ms: number): string {
  if (ms >= 1000) return `${(ms / 1000).toFixed(2)}s`;
  if (ms >= 1) return `${ms.toFixed(1)}ms`;
  return `${(ms * 1000).toFixed(0)}us`;
}

export function statusTag(ok: boolean): string {
  return ok ? c.green('PASS') : c.red('FAIL');
}
