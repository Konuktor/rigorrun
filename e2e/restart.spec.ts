/**
 * Killing the runner in the middle of somebody's work, and starting it again.
 *
 * `external-user.spec.ts` reloads the *page* mid-recording, which proves the
 * interface reads its state from disk rather than holding it in a tab. This
 * proves the harder half: the process holding that state can be killed —
 * SIGKILL, no shutdown, no chance to flush — and everything is still there.
 *
 * That distinction is the whole reason the store writes to a temporary file and
 * renames it. A crash during `writeFile` used to leave a truncated project, and
 * a truncated project used to vanish from the list without a word, which for a
 * product whose promise is "stop any time and pick it up later" is the worst
 * available failure: it looks exactly like the work never happened.
 *
 * So there are two halves here. Kill it and carry on, and then damage a file on
 * purpose and check that RigorRun says so rather than quietly forgetting.
 */
import { expect, test, type Page } from '@playwright/test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type ChildProcess } from 'node:child_process';
import { reissuePairing, repoRoot, startRunner, tsx } from './support/runner.ts';

let home: string;
let runner: ChildProcess;
let pairedUrl: string;

const DESK = join(repoRoot, 'fixtures', 'external', 'mcp-venue-desk', 'src', 'stdio.ts');

async function restart(): Promise<void> {
  // SIGKILL, not SIGTERM. The tidy shutdown path is already exercised by every
  // other suite; what has never been tested is the one that skips it.
  runner.kill('SIGKILL');
  await new Promise((resolve) => runner.once('exit', resolve));
  const started = await startRunner(home);
  runner = started.child;
  pairedUrl = started.match;
}

/**
 * Gets a page paired with whichever runner is currently up.
 *
 * A code is spent on first use, so every pairing needs its own. Asking the
 * runner for one over its stdin is what a person does when they lose the tab,
 * which makes this the only place that feature is exercised end to end.
 */
async function pair(page: Page): Promise<void> {
  pairedUrl = await reissuePairing(runner);
  await page.goto(pairedUrl);
  await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible();
}

test.beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), 'rigorrun-restart-'));
  const started = await startRunner(home);
  runner = started.child;
  pairedUrl = started.match;
});

test.afterAll(async () => {
  runner?.kill('SIGTERM');
  await rm(home, { recursive: true, force: true });
});

test('work survives the runner being killed outright', async ({ page }) => {
  await pair(page);

  // --------------------------------------------------- do some of the work
  await page.getByTestId('project-name').fill('Venue desk agent');
  await page.getByTestId('project-goal').fill('Confirm a held booking.');
  await page.getByTestId('create-project').click();
  await expect(page.getByTestId('step-connect')).toBeVisible();

  await page.getByTestId('transport').selectOption('stdio');
  await page.getByTestId('command').fill(tsx);
  await page.getByTestId('args').fill(DESK);
  await page.getByTestId('safety').selectOption('ephemeral');
  await page.getByTestId('connect').click();
  await expect(page.getByTestId('server-name')).toHaveText('venue-desk');

  for (const tool of ['find_bookings', 'list_venues', 'list_organisers']) {
    const box = page.getByTestId(`verifier-${tool}`);
    if (!(await box.isChecked())) await box.click();
    const readOnly = page.getByTestId(`readonly-${tool}`);
    if (!(await readOnly.isChecked())) await readOnly.click();
  }
  await page.getByTestId('reset-tool').selectOption('reset_desk');
  await page.getByTestId('save-environment').click();

  await expect(page.getByTestId('start-recording')).toBeVisible();
  await page.getByTestId('start-recording').click();

  // A read, then a write. Reads are deliberately kept out of the trace — the
  // contract comes from what changed — so the write is what has to come back.
  await page.getByTestId('tool-picker').selectOption('find_bookings');
  await page.getByTestId('run-tool').click();
  await expect(page.locator('ol li').filter({ hasText: 'find_bookings' }).last()).toBeVisible();

  await page.getByTestId('tool-picker').selectOption('record_signoff');
  await page.getByTestId('param-bookingId').fill('BKG-4001');
  await page.getByTestId('param-approver').fill('Dana Whitlock');
  await page.getByTestId('run-tool').click();
  await expect(page.locator('ol li').filter({ hasText: 'record_signoff' }).last()).toBeVisible();

  // ------------------------------------------------------------ kill it
  await restart();
  await pair(page);

  // The project is still listed, by name, on a runner that has no memory of it.
  await page.getByText('Venue desk agent').click();
  await expect(page.getByRole('heading', { name: 'Venue desk agent' })).toBeVisible();

  // What the system published survived, so the page can be rebuilt without a
  // second handshake.
  await expect(page.getByText('Confirm a held booking.')).toBeVisible();

  // And the half-finished recording is offered back rather than lost. The live
  // connection is genuinely gone — it was a child process of a process that no
  // longer exists — so reconnecting is a step, and the interface says so.
  await expect(page.getByTestId('reconnect')).toBeVisible();
  await page.getByTestId('reconnect').click();
  await expect(page.getByTestId('resume-recording')).toBeVisible({ timeout: 60_000 });
  await page.getByTestId('resume-recording').click();

  // The work that changed the system is still there, on a runner that was
  // started after the one that recorded it had been killed.
  await expect(page.locator('ol li').filter({ hasText: 'record_signoff' }).last()).toBeVisible();
  // And it can be carried on, not merely looked at.
  await expect(page.getByTestId('finish-recording')).toBeVisible();
});

test('a damaged project is reported, not silently dropped', async ({ page }) => {
  await pair(page);

  // Find the project directory the runner just wrote, and ruin it the way an
  // interrupted write would.
  const listed = await page.evaluate(async () => {
    const response = await fetch('/api/projects');
    return (await response.json()) as { projects: { id: string; name: string }[] };
  });
  const target = listed.projects[0]!;

  const path = join(home, 'projects', target.id, 'project.json');
  const original = await readFile(path, 'utf8');
  await writeFile(path, original.slice(0, Math.floor(original.length / 2)));

  await restart();
  await pair(page);

  // Still on the screen, named, with what happened and what to do about it.
  await expect(page.getByTestId(`broken-${target.id}`)).toBeVisible();
  await expect(page.getByText('Could not be opened')).toBeVisible();
  await expect(page.getByTestId(`broken-${target.id}`)).toContainText(/crash|full disk|restore/i);

  // And it is not pretending to be usable.
  await expect(page.getByText(target.name)).toHaveCount(0);
});
