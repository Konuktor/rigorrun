#!/usr/bin/env node
/**
 * Refuses to let the site ship an address that bounces.
 *
 * The security page tells somebody who has found a vulnerability where to send
 * it. If that address does not resolve, the page is worse than one carrying no
 * address at all: it turns a person willing to report a problem privately into
 * a person who believes they already have.
 *
 * So the site build resolves MX itself and simply does not render an address
 * that cannot receive mail — contact falls back to the issue tracker, and a
 * later build picks the address up with no edit. That makes a release safe
 * either way, which is why this is a diagnostic (`pnpm contact`) rather than a
 * release gate: it answers "is the address live yet", not "is it safe to ship".
 *
 * It checks that mail can be delivered, which is what an address has to do to
 * be worth printing. It cannot check that anybody reads the mailbox.
 */
import { resolveMx, resolveTxt } from 'node:dns/promises';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const ESC = '';
const red = (s) => `${ESC}[31m${s}${ESC}[0m`;
const green = (s) => `${ESC}[32m${s}${ESC}[0m`;
const dim = (s) => `${ESC}[90m${s}${ESC}[0m`;

const site = await readFile(
  fileURLToPath(new URL('../apps/site/src/site.ts', import.meta.url)),
  'utf8',
);

/** Every address the site is configured to print. */
const addresses = [...site.matchAll(/'([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})'/g)].map(
  (match) => match[1],
);

if (addresses.length === 0) {
  console.log('No contact address is published. Nothing to check.');
  process.exit(0);
}

const domains = [...new Set(addresses.map((address) => address.split('@')[1]))];
let failed = false;

for (const domain of domains) {
  const shown = addresses.filter((address) => address.endsWith(`@${domain}`)).join(', ');
  try {
    const mx = await resolveMx(domain);
    if (mx.length === 0) throw new Error('no MX records');
    const hosts = mx
      .sort((a, b) => a.priority - b.priority)
      .map((record) => record.exchange)
      .join(', ');
    console.log(`${green('deliverable')}  ${shown}  ${dim(hosts)}`);
  } catch (error) {
    failed = true;
    console.error(
      `${red('NO MAIL')}      ${shown}\n` +
        `             ${domain} has no MX record, so mail to it is refused.\n` +
        `             Enable Email Routing on the ${domain} zone in Cloudflare and\n` +
        `             forward these addresses, or stop publishing them.\n` +
        `             ${dim(String(error.message ?? error))}`,
    );
  }

  // Not fatal. A domain that sends no mail does not strictly need SPF, but a
  // domain with no policy at all is one anybody may spoof, and this is where
  // the security contact lives.
  try {
    const txt = (await resolveTxt(domain)).flat().join(' ');
    if (!txt.includes('v=spf1')) console.log(dim(`             ${domain}: no SPF record`));
  } catch {
    console.log(dim(`             ${domain}: no TXT records at all`));
  }
}

if (failed) {
  console.error(
    red('\nA published address that bounces is worse than no address. Not shipping it.'),
  );
  process.exitCode = 1;
}
