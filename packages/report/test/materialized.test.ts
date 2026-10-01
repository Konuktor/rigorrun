/**
 * A materialized run, as a report shows it.
 *
 * The system's own account of how each case ended goes beside the agent's,
 * in the system's own words and under its own name, so nothing here knows
 * which system it is. A published report keeps the fact that an account was
 * taken and none of what it said, as it does with the agent's prose.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { RunResult } from '@rigorrun/core';
import { clearEnvironments } from '@rigorrun/environment';
import { runBenchmark } from '@rigorrun/runner';
import { explainCase, renderReportHtml, sanitizeRunResult } from '@rigorrun/report';
import {
  SYSTEM_NAME,
  adder,
  fakeBenchmark,
  fakeSession,
  registerFakePack,
} from '../../runner/test/fakePack.ts';

afterEach(() => clearEnvironments());

async function packRun(): Promise<{ run: RunResult; records: string[] }> {
  const session = fakeSession({ simulated: true });
  registerFakePack(session);
  const run = await runBenchmark(
    fakeBenchmark(),
    [adder('liar', 0, 'Added one item of 5 units.'), adder('wrong', 50)],
    { runId: 'run_pack_report' },
  );
  return { run, records: session.made.map((entry) => entry.bindings['record']!) };
}

describe('explaining a materialized case', () => {
  it('carries the system’s account and the read scope, verbatim', async () => {
    const { run, records } = await packRun();
    const explained = explainCase(run.caseResults[0]!);
    expect(explained.claim).toBe('Added one item of 5 units.');
    expect(explained.reality).toEqual({
      system: SYSTEM_NAME,
      lines: [`No item on ${records[0]}.`],
    });
    expect(explained.readScope).toBe(`Record ${records[0]} and the items on it.`);
  });

  it('has neither for a case that carried neither', async () => {
    const { run } = await packRun();
    const { reality: _reality, readScope: _readScope, ...plain } = run.caseResults[0]!;
    const explained = explainCase(plain);
    expect(explained).not.toHaveProperty('reality');
    expect(explained).not.toHaveProperty('readScope');
  });
});

describe('the full report', () => {
  it('shows what the system shows beside what the agent said', async () => {
    const { run, records } = await packRun();
    const html = renderReportHtml(run, { generatedAt: '2026-10-01T00:00:00.000Z' });
    expect(html).toContain('<h3>The agent said</h3>');
    expect(html).toContain(`<h3>${SYSTEM_NAME} shows</h3>`);
    expect(html).toContain(`<li>No item on ${records[0]}.</li>`);
    expect(html).toMatch(new RegExp(`<li>Item itm_\\d+ of 50 units on ${records[1]}\\.</li>`));
    expect(html).toContain(`Read: Record ${records[0]} and the items on it.`);
    expect(html).toContain(
      `Created for this case: record ${records[0]} · label Label of ${records[0]}`,
    );
  });

  it('shows the read scope and the simulated limit where the limits are', async () => {
    const { run, records } = await packRun();
    const html = renderReportHtml(run);
    const metadata = html.slice(html.indexOf('Benchmark metadata'));
    expect(metadata).toContain('ran against the local twin, not the real system');
    expect(metadata).toContain(`<dt>Read</dt><dd>Record ${records[0]} and the items on it.</dd>`);
    expect(metadata).toContain('<dd>FRESH_OBJECTS</dd>');
  });

  it('escapes what the system says, which may quote what an outsider wrote', async () => {
    const { run } = await packRun();
    const hostile: RunResult = {
      ...run,
      caseResults: run.caseResults.map((entry) => ({
        ...entry,
        reality: { system: 'A <b>system</b>', lines: ['<img src=x onerror=alert(1)>'] },
      })),
    };
    const html = renderReportHtml(hostile);
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).toContain('A &lt;b&gt;system&lt;/b&gt; shows');
  });
});

describe('the published report', () => {
  it('keeps whose account it was, and withholds what it said', async () => {
    const { run } = await packRun();
    const published = sanitizeRunResult(run);
    for (const entry of published.caseResults) {
      expect(entry.reality).toEqual({
        system: SYSTEM_NAME,
        lines: ['(withheld from the published report)'],
      });
      expect(entry).not.toHaveProperty('materialized');
    }
  });

  it('names none of the records a case created, anywhere', async () => {
    const { run, records } = await packRun();
    const published = sanitizeRunResult(run);
    const html = renderReportHtml(run, { mode: 'published' });
    for (const record of records) {
      expect(JSON.stringify(run)).toContain(record);
      expect(JSON.stringify(published)).not.toContain(record);
      expect(html).not.toContain(record);
    }
    // The scope is still said, with its identifiers masked.
    expect(published.caseResults[0]!.readScope).toBe('Record ‹id› and the items on it.');
    expect(html).toContain(`<h3>${SYSTEM_NAME} shows</h3>`);
    expect(html).toContain('What the system showed at the end of each case is removed');
  });
});
