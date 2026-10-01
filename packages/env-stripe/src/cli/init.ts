/**
 * `rigorrun stripe init` — a project that tests a refund agent against Stripe.
 *
 * A founder's first two minutes with the product, so it asks for little and
 * says plainly what it did. Everything that could refuse refuses before
 * anything is stored: the key's prefix, then Stripe's own word that the key is
 * in test mode, then whether the rules can be put to a person. Only then is the
 * key put in this machine's secret store (never in the project), the project
 * made, its connection opened, and the pack's suite installed with exactly the
 * rules that person confirmed.
 *
 * It ends by writing one example of the work the agent will be sent — the
 * same envelope, bound to example ids — and the three commands that come next.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { parseArgs } from 'node:util';
import { ZodError } from 'zod';
import { bindCase, publicCaseView, type BenchmarkCase } from '@rigorrun/core';
import { taskEnvelope } from '@rigorrun/daemon';
import { createStripeClient } from '../client.ts';
import { KEY_SECRET, STRIPE_PACK_ID, TWIN_URL } from '../conventions.ts';
import { KeyGuardError, confirmTestMode, guardKey } from '../keyGuard.ts';
import { resolveBaseUrl } from '../session.ts';
import { emailFor, orderRefFor } from '../materialize.ts';
import { parseStripePolicy, type StripePolicy, type StripePolicyInput } from '../policy.ts';
import { formatMinorUnits } from '../reality.ts';
import { BINDING_NAMES } from '../recipe.ts';
import { stripeRules } from '../rules.ts';
import { CANARY_AMOUNT, CANARY_CASE_ID } from '../scenarios.ts';
import { UsageError, messageOf, rows, say, withService } from './common.ts';
import { TWIN_AGENT_KEY } from './twin.ts';

/** Where the twin's key is kept, so trying the twin never overwrites a real test key. */
export const TWIN_KEY_SECRET = 'stripe_twin_key';
export const DEFAULT_KEY_ENV = 'STRIPE_TEST_KEY';
export const DEFAULT_DIR = 'rigorrun-stripe';
export const TICKET_FILE = 'ticket.example.json';
/** The case the example ticket is written from. */
const EXAMPLE_CASE = 'full_refund';

export const INIT_USAGE = `rigorrun stripe init - a project that tests a refund agent against Stripe

  rigorrun stripe init --twin [url]                           the local twin; no keys
  rigorrun stripe init --key-env STRIPE_TEST_KEY --safety staging   your test mode

Checks the key is a test-mode key (by its prefix, then by asking Stripe),
asks you to confirm each rule of the refund policy, stores the key in this
machine's secret store, creates the project and installs its suite: the seven
pre-registered tickets and a ${formatMinorUnits(CANARY_AMOUNT, 'usd')} canary. Live mode is never used.

OPTIONS
      --twin [url]              Use the local twin (default ${TWIN_URL}); start it
                                with \`rigorrun stripe twin\`. No key needed.
      --key-env <NAME>          Test mode: the environment variable holding your
                                test key (sk_test_… or rk_test_…). Default ${DEFAULT_KEY_ENV}.
                                Read from the environment, never from a flag.
      --safety <kind>           staging, ephemeral or local. Required for test
                                mode; the twin is local. Never production.
      --name <name>             The project's name.
      --currency <code>         The cases' currency, with two decimals. Default usd.
      --escalate-above <amount> Refunds above this wait for a person, e.g. $100.
                                Adds one rule and one case.
      --yes                     Confirm every rule without asking. Needed when
                                there is no terminal to ask in.
      --dir <path>              Where ${TICKET_FILE} goes. Default ./${DEFAULT_DIR}.
      --home <path>             Where projects live.
      --json                    Print what was made, as JSON.`;

/** How init talks to the person running it; replaced in tests. */
export interface InitIo {
  /** Whether a person can be asked anything. */
  interactive: boolean;
  ask(question: string): Promise<string>;
}

export function terminalIo(): InitIo {
  return {
    interactive: process.stdin.isTTY === true,
    async ask(question) {
      const prompt = createInterface({ input: process.stdin, output: process.stdout });
      try {
        return await prompt.question(question);
      } finally {
        prompt.close();
      }
    },
  };
}

/** `--twin` takes an optional address, which `parseArgs` cannot say. */
function withTwinValue(argv: readonly string[]): string[] {
  const out: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    const next = argv[index + 1];
    if (arg === '--twin' && (next === undefined || next.startsWith('-')))
      out.push(`--twin=${TWIN_URL}`);
    else out.push(arg);
  }
  return out;
}

/** `$100`, `100`, `1,000.50`, `100 usd` — as minor units of a two-decimal currency. */
export function parseAmount(raw: string, currency: string): number {
  const text = raw
    .trim()
    .replace(/^[$€£]/, '')
    .replace(new RegExp(`\\s*${currency}$`, 'i'), '')
    .replace(/,/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(text)) {
    throw new UsageError(`--escalate-above takes an amount such as $100 or 250.00, not "${raw}".`);
  }
  const [whole, fraction = ''] = text.split('.');
  return Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
}

function policyFrom(currency: string, escalate: string | undefined): StripePolicyInput {
  const code = currency.toLowerCase();
  const input: StripePolicyInput = {
    currency: code,
    ...(escalate === undefined ? {} : { escalateAbove: parseAmount(escalate, code) }),
  };
  try {
    parseStripePolicy(input);
  } catch (error) {
    if (error instanceof ZodError) {
      throw new UsageError(
        `That policy cannot be tested: ${error.issues[0]?.message ?? 'invalid'}.`,
      );
    }
    throw error;
  }
  return input;
}

/**
 * One envelope exactly as the agent will receive it, bound to example ids.
 *
 * Built the way a run builds it — the case bound, then the public view, then
 * the envelope — so the file cannot drift from what is really sent.
 */
export function exampleTicket(testCase: BenchmarkCase): unknown {
  const ctx = { runId: 'run_example', agentId: 'my-agent', caseId: testCase.id, attempt: 0 };
  const ids: Record<string, string> = {
    customer: 'cus_Example0001',
    customer_email: emailFor(ctx, 'customer'),
    payment_intent: 'pi_Example0001',
    charge: 'ch_Example0001',
    order_ref: orderRefFor(ctx, 'charge'),
    other_customer: 'cus_Example0002',
    other_charge: 'ch_Example0002',
    other_order_ref: orderRefFor(ctx, 'other_charge'),
  };
  const bindings = Object.fromEntries(BINDING_NAMES.map((name) => [name, ids[name] ?? name]));
  const bound = bindCase(testCase, bindings);
  return taskEnvelope({
    caseId: bound.id,
    task: publicCaseView(bound).task,
    maxSteps: bound.maxSteps,
  });
}

export async function cmdInit(argv: string[], io: InitIo = terminalIo()): Promise<number> {
  const { values } = parseArgs({
    args: withTwinValue(argv),
    options: {
      twin: { type: 'string' },
      'key-env': { type: 'string' },
      safety: { type: 'string' },
      name: { type: 'string' },
      currency: { type: 'string' },
      'escalate-above': { type: 'string' },
      yes: { type: 'boolean', default: false },
      dir: { type: 'string' },
      home: { type: 'string' },
      json: { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h' },
    },
    strict: true,
  });
  if (values.help) {
    say(INIT_USAGE);
    return 0;
  }

  // ------------------------------------------------- refused before anything
  const twin = values.twin !== undefined;
  const keyEnv = values['key-env'] ?? (twin ? undefined : DEFAULT_KEY_ENV);
  const key = keyEnv === undefined ? TWIN_AGENT_KEY : process.env[keyEnv];
  if (key === undefined || key.trim() === '') {
    throw new UsageError(
      `Set ${keyEnv} to your Stripe test-mode secret key (sk_test_…), then run this again. It is ` +
        'read from the environment so it never sits in your shell history. To try RigorRun with ' +
        'no key at all, use --twin.',
    );
  }
  const safety = values.safety ?? (twin ? 'local' : undefined);
  if (safety === 'production') {
    throw new UsageError(
      'The Stripe pack is never run against something marked production: every case creates ' +
        'customers, payments and refunds. Mark a test account staging.',
    );
  }
  if (safety === undefined || !['staging', 'ephemeral', 'local'].includes(safety)) {
    throw new UsageError(
      safety === undefined
        ? 'Say what kind of account this is with --safety staging, ephemeral or local. RigorRun will ' +
            'not guess whether it may create records somewhere.'
        : `--safety is staging, ephemeral or local, not "${safety}".`,
    );
  }
  const policyInput = policyFrom(values.currency ?? 'usd', values['escalate-above']);
  const policy: StripePolicy = parseStripePolicy(policyInput);
  if (!values.yes && !io.interactive) {
    throw new UsageError(
      'Each rule needs your yes, and there is no terminal to ask in. Pass --yes to confirm every ' +
        'rule (they are listed as they are confirmed), or run this in a terminal to choose.',
    );
  }

  const mode = twin ? ('twin' as const) : ('live' as const);
  const baseUrl = twin ? values.twin! : undefined;
  const keySecret = twin ? TWIN_KEY_SECRET : KEY_SECRET;
  let address: string;
  let guarded: string;
  try {
    address = resolveBaseUrl(mode, baseUrl);
    guarded = guardKey(key, keyEnv === undefined ? keySecret : `$${keyEnv}`);
  } catch (error) {
    throw new UsageError(messageOf(error));
  }
  const client = createStripeClient({ baseUrl: address, key: guarded, maxRetries: 0 });
  try {
    await confirmTestMode(client, guarded);
  } catch (error) {
    if (error instanceof KeyGuardError) throw new UsageError(error.message);
    throw new UsageError(
      twin
        ? `Nothing answered at ${address}. Start the twin first, in another terminal: rigorrun stripe twin`
        : `Could not reach Stripe to confirm the key is in test mode: ${messageOf(error)}`,
    );
  } finally {
    client.close();
  }

  const where = twin ? `local twin at ${address}` : 'your Stripe test mode';
  const human = !values.json;
  if (human) {
    say(`Stripe pack · ${where}`);
    say(
      twin
        ? '  key   any test key works here; nothing reaches Stripe'
        : '  key   test mode, confirmed by Stripe',
    );
    say();
    say('Rules — only the ones you confirm can fail your agent');
  }

  // ----------------------------------------------------------- the rules
  const confirmedRuleIds: string[] = [];
  for (const rule of stripeRules(policy)) {
    let yes = values.yes;
    if (!yes) {
      say(`  ${rule.statement}`);
      const answer = (await io.ask('    Confirm? [Y/n] ')).trim().toLowerCase();
      yes = answer === '' || answer === 'y' || answer === 'yes';
    } else if (human) {
      say(`  ✓ ${rule.statement}`);
    }
    if (yes) confirmedRuleIds.push(rule.id);
  }
  const ruleCount = stripeRules(policy).length;

  // ----------------------------------------------------- now it is stored
  const name = values.name ?? (twin ? 'Stripe refunds (twin)' : 'Stripe refunds');
  const made = await withService(values.home, async (service, store) => {
    await store.setSecret(keySecret, guarded);
    const project = await service.createProject({
      name,
      goal: 'Resolve a customer’s refund request according to the policy.',
    });
    await service.connectEnvironment(
      project.id,
      { kind: 'pack', pack: STRIPE_PACK_ID, mode, keySecret, ...(baseUrl ? { baseUrl } : {}) },
      safety as 'staging' | 'ephemeral' | 'local',
    );
    const installed = await service.installPackSuite(
      project.id,
      { policy: policyInput, confirmedRuleIds, createdAt: new Date().toISOString(), canary: true },
      { confirmedRuleIds },
    );
    return { project, benchmark: installed.benchmark };
  });

  const dir = resolve(values.dir ?? DEFAULT_DIR);
  const ticketPath = resolve(dir, TICKET_FILE);
  const example = made.benchmark.cases.find((testCase) => testCase.id === EXAMPLE_CASE);
  if (example) {
    await mkdir(dir, { recursive: true });
    await writeFile(ticketPath, `${JSON.stringify(exampleTicket(example), null, 2)}\n`, 'utf8');
  }

  const id = made.project.id;
  const home = values.home ? ` --home ${values.home}` : '';
  const next = [
    `rigorrun agent add --project ${id} --name my-agent --black-box <url> --claim-path message${home}`,
    `rigorrun stripe canary --project ${id} --agent my-agent${home}`,
    `rigorrun gate --project ${id} --report report.html${home}`,
  ];
  const caseIds = made.benchmark.cases.map((testCase) => testCase.id);

  if (values.json) {
    say(
      JSON.stringify(
        {
          projectId: id,
          name,
          mode,
          ...(baseUrl ? { baseUrl } : {}),
          keySecret,
          safety,
          confirmedRuleIds,
          rules: ruleCount,
          cases: caseIds,
          ticket: example ? ticketPath : null,
          next,
        },
        null,
        2,
      ),
    );
    return 0;
  }

  const shownTicket = relative(process.cwd(), ticketPath) || ticketPath;
  const tickets = caseIds.filter((caseId) => caseId !== CANARY_CASE_ID).length;
  say();
  for (const line of rows([
    ['project', `${id}  ${name}`],
    [
      'suite',
      `${tickets} tickets and a ${formatMinorUnits(CANARY_AMOUNT, policy.currency)} canary · ${confirmedRuleIds.length} of ${ruleCount} rules confirmed`,
    ],
    ['key', `stored as ${keySecret} in this machine's secret store, not in the project`],
    ...(example ? [['ticket', `${shownTicket} — what your agent will be sent`] as const] : []),
  ])) {
    say(line);
  }
  if (confirmedRuleIds.length < ruleCount) {
    say('  (a rule you did not confirm still runs, and is reported, but never fails the agent)');
  }
  say();
  say('Next');
  for (const command of next) say(`  ${command}`);
  return 0;
}
