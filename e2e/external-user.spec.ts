/**
 * A stranger, in a browser, from nothing to a verdict.
 *
 * This is the test that replaces "all the other tests are green" as the
 * definition of done. It starts with no project, no contract, no benchmark and
 * no demo, and it uses only what a person can see and click.
 *
 * Both of the things being connected are outside RigorRun. The system is
 * `fixtures/external/mcp-venue-desk`, a separate package spawned as a child
 * process and reached over MCP. The agent is `fixtures/external/booking-agent`,
 * a separate process that drives itself through the proxy with its own MCP
 * client. If this passes, somebody who has never read this source can do what
 * it does.
 */
import { expect, test, type Page } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { mkdir } from 'node:fs/promises';

const root = fileURLToPath(new URL('..', import.meta.url));
const tsx = join(root, 'node_modules', '.bin', 'tsx');

/**
 * Screenshots as evidence, not as decoration.
 *
 * Somebody reading a claim that this works should be able to look at what the
 * person actually saw, at each point where the product asserts something.
 */
const SHOTS = join(root, 'docs', 'external-user-run');
let shot = 0;
async function evidence(page: Page, name: string): Promise<void> {
  shot += 1;
  await page.screenshot({
    path: join(SHOTS, `${String(shot).padStart(2, '0')}-${name}.png`),
    fullPage: true,
  });
}

let home: string;
let runner: ChildProcess;
let agent: ChildProcess;
let pairedUrl: string;
const AGENT_PORT = 8912;

/**
 * What is under test: the sources, or the thing a stranger would install.
 *
 * `RIGORRUN_BIN` points at an installed executable — the tarball, unpacked into
 * a clean directory by `scripts/verify-package.mjs`. Without it the test drives
 * the sources through `tsx`, which is the fast loop while developing.
 *
 * The same spec covers both on purpose. A packaged artifact that passes a
 * *different* test from the one the sources pass has not been tested.
 */
const PACKAGED = process.env['RIGORRUN_BIN'];

/** Starts a process and waits for the line that says it is ready. */
function startAndWait(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  ready: RegExp,
): Promise<{ child: ChildProcess; match: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, env: { ...process.env, ...env } });
    let buffer = '';
    const timer = setTimeout(() => reject(new Error(`timed out waiting for ${ready}`)), 90_000);
    const onData = (chunk: Buffer): void => {
      buffer += String(chunk);
      const found = ready.exec(buffer);
      if (found) {
        clearTimeout(timer);
        child.stdout?.off('data', onData);
        resolve({ child, match: found[0] });
      }
    };
    child.stdout?.on('data', onData);
    child.stderr?.on('data', (chunk: Buffer) => {
      buffer += String(chunk);
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`process exited with ${code}: ${buffer.slice(-800)}`));
    });
  });
}

test.beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), 'rigorrun-e2e-'));
  await mkdir(SHOTS, { recursive: true });

  // Exactly what the quickstart tells a person to run.
  const started = await startAndWait(
    PACKAGED ?? tsx,
    PACKAGED ? [] : [join(root, 'packages', 'cli', 'src', 'bin.ts')],
    { RIGORRUN_HOME: home, NO_COLOR: '1' },
    /http:\/\/127\.0\.0\.1:\d+\/\?code=[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}/,
  );
  runner = started.child;
  pairedUrl = started.match;

  const agentStarted = await startAndWait(
    tsx,
    [join(root, 'fixtures', 'external', 'booking-agent', 'src', 'main.ts')],
    { PORT: String(AGENT_PORT) },
    /listening on http:\/\/127\.0\.0\.1:\d+/,
  );
  agent = agentStarted.child;
});

test.afterAll(async () => {
  runner?.kill('SIGTERM');
  agent?.kill('SIGTERM');
  await rm(home, { recursive: true, force: true });
});

/** Ticks a checkbox by its test id, tolerating one already ticked. */
async function ensureChecked(page: Page, testId: string, checked: boolean): Promise<void> {
  const box = page.getByTestId(testId);
  if ((await box.isChecked()) !== checked) await box.click();
}

test('a stranger connects their own system and their own agent, and gets a verdict', async ({
  page,
}) => {
  // ---------------------------------------------------------------- pairing
  await page.goto(pairedUrl);
  await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible();
  // Nothing is set up from a template.
  await expect(page.getByText('Start here')).toBeVisible();
  await evidence(page, 'no-projects');

  // ------------------------------------------------------- 1. make a project
  await page.getByTestId('project-name').fill('Venue desk agent');
  await page.getByTestId('project-goal').fill('Confirm a held booking.');
  await page.getByTestId('create-project').click();

  await expect(page.getByTestId('step-connect')).toBeVisible();
  await expect(page.getByText('Connect the system your agent will work in.')).toBeVisible();

  // ----------------------------------------------- 2. connect their own system
  await page.getByTestId('transport').selectOption('stdio');
  await page.getByTestId('command').fill(tsx);
  await page
    .getByTestId('args')
    .fill(join(root, 'fixtures', 'external', 'mcp-venue-desk', 'src', 'stdio.ts'));
  await page.getByTestId('safety').selectOption('ephemeral');
  await page.getByTestId('connect').click();

  // Real discovery, from a real handshake. Located by the control rather than
  // by the text, which also appears in the reset dropdown below.
  await expect(page.getByTestId('server-name')).toHaveText('venue-desk');
  await expect(page.getByTestId('readonly-confirm_booking')).toBeVisible();
  await expect(page.getByTestId('readonly-record_signoff')).toBeVisible();

  // A server's claim is shown as a claim, and a tool it said nothing about is
  // assumed to write.
  await expect(page.getByText("server’s claim").first()).toBeVisible();
  await evidence(page, 'tools-discovered');
  await expect(page.getByText('unknown').first()).toBeVisible();
  await expect(
    page.getByText('The server published no hint. Treated as writing until shown otherwise.'),
  ).toBeVisible();

  // ----------------------------------- 3. say what reads and what puts it back
  for (const tool of ['find_bookings', 'list_venues', 'list_organisers']) {
    await ensureChecked(page, `verifier-${tool}`, true);
    await ensureChecked(page, `readonly-${tool}`, true);
  }
  await ensureChecked(page, 'readonly-get_booking', true);
  await page.getByTestId('reset-tool').selectOption('reset_desk');
  await page.getByTestId('save-environment').click();

  // --------------------------------------------------- 4. do the job once
  await expect(page.getByTestId('start-recording')).toBeVisible();
  await page.getByTestId('start-recording').click();
  await expect(page.getByText('recording')).toBeVisible();

  const doStep = async (tool: string, params: Record<string, string>): Promise<void> => {
    await page.getByTestId('tool-picker').selectOption(tool);
    for (const [name, value] of Object.entries(params)) {
      await page.getByTestId(`param-${name}`).fill(value);
    }
    await page.getByTestId('run-tool').click();
    // The log grows by one, which is the only signal that does not collide
    // with the tool's name appearing in the picker.
    await expect(page.locator('ol li').filter({ hasText: tool }).last()).toBeVisible();
  };

  await doStep('find_bookings', {});
  await doStep('get_booking', { bookingId: 'BKG-4001' });
  await doStep('record_signoff', { bookingId: 'BKG-4001', approver: 'Dana Whitlock' });
  await doStep('confirm_booking', { bookingId: 'BKG-4001' });

  // A reload in the middle of recording. This is the moment the previous
  // version of the product lost twenty minutes of somebody's real work in a
  // real system, so it is worth proving rather than assuming.
  await page.reload();
  await expect(page.getByTestId('resume-recording')).toBeVisible();
  await page.getByTestId('resume-recording').click();
  // What was already done is still there.
  await expect(page.locator('ol li').filter({ hasText: 'confirm_booking' }).last()).toBeVisible();
  await evidence(page, 'resumed-after-reload');

  await page.getByTestId('finish-recording').click();
  await evidence(page, 'job-demonstrated');

  // ------------------------------------------- 5. review what it worked out
  await expect(page.getByText(/worked these out by looking at/)).toBeVisible();
  // The question no data could have answered, asked with its reason.
  await expect(page.getByText('injection payloads').first()).toBeVisible();

  await page.getByTestId('answer-q_unit_Booking_depositAmount').selectOption('currency');
  await page.getByTestId('answer-q_role_Booking_signedOffBy').selectOption('actor');
  await page.getByTestId('answer-q_untrusted_Booking_note').selectOption('yes');
  await page.getByTestId('save-answers').click();
  await evidence(page, 'what-it-learned');

  // ------------------------------------------------------ 6. rule, then build
  await page.getByTestId('compile').click();
  await expect(page.getByText('Guesses, every one.')).toBeVisible();
  await page.getByTestId('generate').click();

  await expect(page.getByTestId('suite-size')).toContainText('cases built');
  await evidence(page, 'suite-built');

  // ----------------------------------------------- 7. connect their own agent
  await page.getByTestId('agent-name').fill('Booking agent');
  await page.getByTestId('agent-endpoint').fill(`http://127.0.0.1:${AGENT_PORT}/`);
  await page.getByTestId('add-agent').click();
  await expect(page.getByText('answering')).toBeVisible();
  await evidence(page, 'agent-connected');

  // ------------------------------------------------------------- 8. run it
  await page.getByTestId('to-run').click();
  await page.getByRole('button', { name: /^Run Booking agent$/ }).click();

  await expect(page.getByTestId('verdict')).toBeVisible({ timeout: 180_000 });

  // A verdict never appears without how it was reached beside it.
  await expect(page.getByText('verified: PARTIAL')).toBeVisible();
  await expect(page.getByText('isolation: RESET')).toBeVisible();

  // And what this system cost the suite is said rather than hidden.
  await expect(page.getByText('What this system stopped RigorRun doing')).toBeVisible();

  // The activation metric, measured by the product rather than by us. Machine
  // time is what a benchmark takes; this is what a person took.
  await expect(page.getByTestId('time-to-verdict')).toBeVisible();

  await evidence(page, 'verdict');
});
