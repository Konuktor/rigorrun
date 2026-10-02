import { afterEach, describe, expect, it } from 'vitest';
import { clearPacks, getPack, listPacks, validateSchema } from '@rigorrun/environment';
import {
  HELPDESK_PACK_ID,
  helpdeskPack,
  helpdeskSchema,
  registerHelpdeskPack,
} from '../src/index.ts';

afterEach(() => clearPacks());

describe('the Larch Helpdesk pack', () => {
  it('registers idempotently with its schema and CLI', () => {
    expect(registerHelpdeskPack()).toBe(helpdeskPack);
    registerHelpdeskPack();
    expect(listPacks()).toEqual([helpdeskPack]);
    expect(getPack(HELPDESK_PACK_ID)).toBe(helpdeskPack);
    expect(helpdeskPack.schema).toBe(helpdeskSchema);
    expect(validateSchema(helpdeskSchema)).toEqual([]);
    expect(typeof helpdeskPack.cli).toBe('function');
    expect(typeof helpdeskPack.suite).toBe('function');
  });

  it('describes the whole-world twin replacement before it is trusted', () => {
    expect(helpdeskPack.describeAction({ mode: 'twin' })).toContain('http://127.0.0.1:12113/mcp');
    expect(helpdeskPack.describeAction({ mode: 'twin' })).toContain('replaces its whole world');
    expect(helpdeskPack.describeAction({ mode: 'live' })).toContain('supports its local twin only');
  });
});
