/**
 * What the troubleshooting page tells a founder about the Stripe path, held
 * to what the pack actually prints.
 *
 * The four things a first run met and the page did not cover: a case that
 * timed out, a local model that is slow, a refund "outside this case", and
 * the twin. Where the page quotes RigorRun, the quote must be what RigorRun
 * says, or a stranger searching for the words on their screen finds nothing.
 */
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { timeoutAdvice } from '@rigorrun/report';
import { STRIPE_CASE_TIMEOUT_MS, TWIN_URL, describeLateWrites } from '../src/index.ts';

const page = () =>
  readFile(
    new URL('../../../apps/docs/src/content/docs/troubleshooting.md', import.meta.url),
    'utf8',
  );

/** Typographic and straight apostrophes read the same to a person searching. */
const plain = (text: string) => text.replace(/’/g, "'").replace(/\s+/g, ' ');

describe('the troubleshooting page, on the Stripe path', () => {
  it('explains a timed-out case with the budget and the flag that changes it', async () => {
    const text = plain(await page());
    expect(text).toContain('**A case says `TIMED_OUT`.**');
    expect(text).toContain(
      `${STRIPE_CASE_TIMEOUT_MS / 60_000} minutes per ticket in the Stripe pack`,
    );
    expect(text).toContain('--case-timeout <ms>');
    // The flag the CLI suggests is the one the page suggests.
    expect(timeoutAdvice(STRIPE_CASE_TIMEOUT_MS)).toContain('--case-timeout 600000');
    expect(text).toContain('--case-timeout 600000');
  });

  it('says a local model can need minutes per ticket', async () => {
    expect(plain(await page())).toContain('**A local model is slow.**');
  });

  it('quotes the late-write line as the pack prints it', async () => {
    const text = plain(await page());
    expect(text).toContain('**A refund shows up "outside this case".**');
    const [line] = describeLateWrites([
      {
        refund: 're_1',
        amount: 100,
        currency: 'usd',
        status: 'succeeded',
        charge: 'ch_1',
        madeFor: { run: 'r', agent: 'a', case: 'c', attempt: '0' },
      },
    ]);
    const [before, after] = plain(line!).split(/re_1 .*?made for c/);
    expect(text).toContain(before!.trim());
    expect(text).toContain(after!.trim());
  });

  it('says how to start the twin and what its address is', async () => {
    const text = plain(await page());
    expect(text).toContain(`"Nothing answered at ${TWIN_URL}"`);
    expect(text).toContain('npx rigorrun stripe twin');
  });
});
