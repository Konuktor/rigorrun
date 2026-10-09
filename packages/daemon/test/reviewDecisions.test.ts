import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compileWorkflow, WORKFLOWS } from '@rigorrun/environments';
import type { EnvironmentContract } from '@rigorrun/core';
import { ProxyServer } from '@rigorrun/proxy';
import { ProjectStore, Service } from '../src/index.ts';

let dir: string;
let store: ProjectStore;
let service: Service;
let id: string;
let draft: EnvironmentContract;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'rigorrun-review-'));
  store = new ProjectStore(dir);
  service = new Service({ store, proxy: new ProxyServer() });
  id = (await service.createProject({ name: 'Review decisions' })).id;
  draft = (await compileWorkflow(WORKFLOWS[0]!)).draft;
});
beforeEach(async () => { await store.writeArtefact(id, 'contract', draft); });
afterAll(async () => { await rm(dir, { recursive: true, force: true }); });

it.each(['confirmedRuleIds', 'rejectedRuleIds'] as const)('rejects unknown and duplicate %s without modifying the contract', async (key) => {
  await expect(service.review(id, { [key]: ['missing-rule'] })).rejects.toThrow(/rule/i);
  const ruleId = draft.rules[0]!.id;
  await expect(service.review(id, { [key]: [ruleId, ruleId] })).rejects.toThrow(/duplicate/i);
  expect(await store.readArtefact(id, 'contract')).toEqual(draft);
});

it('rejects a rule present in both decision arrays', async () => {
  const ruleId = draft.rules[0]!.id;
  await expect(service.review(id, { confirmedRuleIds: [ruleId], rejectedRuleIds: [ruleId] })).rejects.toThrow(/both|conflict/i);
  expect(await store.readArtefact(id, 'contract')).toEqual(draft);
});

it('records explicit yes/no decisions and leaves omissions inferred', async () => {
  const [yes, no, omitted] = draft.rules;
  const reviewed = await service.review(id, { confirmedRuleIds: [yes!.id], rejectedRuleIds: [no!.id] });
  expect(reviewed.rules.find((r) => r.id === yes!.id)?.status).toBe('confirmed');
  expect(reviewed.rules.find((r) => r.id === no!.id)?.status).toBe('rejected');
  expect(reviewed.rules.find((r) => r.id === omitted!.id)?.status).toBe('inferred');
});
