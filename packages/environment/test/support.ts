/**
 * A deliberately neutral environment used to test the SDK itself.
 *
 * The names mean nothing on purpose. If these tests passed only because the
 * projection understood refunds or invoices, that would be the bug they exist
 * to catch.
 */
import {
  defineEnvironment,
  stateFromRows,
  type EnvironmentFixture,
  type EnvironmentSchema,
} from '@rigorrun/environment';

export const TEST_SCHEMA: EnvironmentSchema = {
  entities: [
    {
      name: 'Account',
      idField: 'accountId',
      mutable: false,
      appendOnly: false,
      fields: [
        { name: 'accountId', type: 'string', nullable: false, role: 'identifier' },
        { name: 'label', type: 'string', nullable: false, role: 'freetext' },
        {
          name: 'tier',
          type: 'enum',
          nullable: false,
          role: 'status',
          enumValues: ['standard', 'premium'],
        },
      ],
    },
    {
      name: 'Item',
      idField: 'itemId',
      mutable: true,
      appendOnly: false,
      fields: [
        { name: 'itemId', type: 'string', nullable: false, role: 'identifier' },
        { name: 'accountId', type: 'string', nullable: false, role: 'identifier' },
        {
          name: 'value',
          type: 'number',
          nullable: false,
          role: 'quantity',
          unit: 'currency',
          precision: 0.01,
        },
        {
          name: 'state',
          type: 'enum',
          nullable: false,
          role: 'status',
          enumValues: ['active', 'retired'],
        },
      ],
    },
    {
      name: 'Permit',
      idField: 'permitId',
      mutable: true,
      appendOnly: false,
      fields: [
        { name: 'permitId', type: 'string', nullable: false, role: 'identifier' },
        { name: 'itemId', type: 'string', nullable: false, role: 'identifier' },
        { name: 'approver', type: 'string', nullable: true, role: 'actor' },
        {
          name: 'state',
          type: 'enum',
          nullable: false,
          role: 'status',
          enumValues: ['pending', 'granted', 'denied'],
        },
      ],
    },
    {
      name: 'Claim',
      idField: 'claimId',
      mutable: false,
      appendOnly: false,
      fields: [
        { name: 'claimId', type: 'string', nullable: false, role: 'identifier' },
        { name: 'accountId', type: 'string', nullable: false, role: 'identifier' },
        { name: 'itemId', type: 'string', nullable: false, role: 'identifier' },
        { name: 'permitId', type: 'string', nullable: true, role: 'identifier' },
        {
          name: 'amount',
          type: 'number',
          nullable: false,
          role: 'quantity',
          unit: 'currency',
          precision: 0.01,
        },
        { name: 'filedBy', type: 'string', nullable: true, role: 'actor' },
      ],
    },
    {
      name: 'LogEntry',
      idField: 'logId',
      mutable: false,
      appendOnly: true,
      referenceFields: ['detail'],
      fields: [
        { name: 'logId', type: 'string', nullable: false, role: 'identifier' },
        { name: 'action', type: 'string', nullable: false, role: 'identifier' },
        { name: 'detail', type: 'string', nullable: false, role: 'freetext' },
      ],
    },
  ],
  relationships: [
    {
      name: 'account',
      from: 'Claim',
      to: 'Account',
      via: { kind: 'fk', field: 'accountId' },
      cardinality: 'one',
      required: true,
    },
    {
      name: 'item',
      from: 'Claim',
      to: 'Item',
      via: { kind: 'fk', field: 'itemId' },
      cardinality: 'one',
      required: true,
    },
    {
      name: 'permit',
      from: 'Claim',
      to: 'Permit',
      via: { kind: 'fk', field: 'permitId' },
      cardinality: 'one',
      required: false,
    },
    {
      name: 'account',
      from: 'Item',
      to: 'Account',
      via: { kind: 'fk', field: 'accountId' },
      cardinality: 'one',
      required: true,
    },
    {
      name: 'item',
      from: 'Permit',
      to: 'Item',
      via: { kind: 'fk', field: 'itemId' },
      cardinality: 'one',
      required: true,
    },
    {
      name: 'claims',
      from: 'Item',
      to: 'Claim',
      via: { kind: 'fk', field: 'itemId' },
      cardinality: 'many',
      required: false,
    },
  ],
};

const BASE_ROWS = {
  Account: [
    { accountId: 'ACC-1', label: 'First account', tier: 'standard' },
    { accountId: 'ACC-2', label: 'Second account', tier: 'premium' },
  ],
  Item: [
    { itemId: 'ITM-1', accountId: 'ACC-1', value: 120, state: 'active' },
    { itemId: 'ITM-2', accountId: 'ACC-2', value: 80, state: 'retired' },
  ],
  Permit: [],
  Claim: [],
  LogEntry: [],
};

export const TEST_FIXTURE: EnvironmentFixture = {
  id: 'baseline',
  title: 'Baseline',
  summary: 'One account with one active item and no claim yet.',
  state: stateFromRows(TEST_SCHEMA, BASE_ROWS),
  config: { approver_response: 'grant' },
  request: { accountId: 'ACC-1', itemId: 'ITM-1', amount: 30 },
};

export const testEnvironment = defineEnvironment({
  id: 'sdk-test',
  name: 'SDK test environment',
  description: 'Neutral fixture used to test the environment SDK itself.',
  schema: TEST_SCHEMA,
  presentation: {
    label: 'SDK test',
    tagline: 'Nothing to see here',
    accent: '#334155',
    mark: 'T',
    navEntities: ['Account', 'Item'],
    focusEntity: 'Claim',
  },
  caseConfig: [
    {
      name: 'approver_response',
      values: ['grant', 'deny', 'never_responds'],
      default: 'grant',
      description: 'How the permit approver responds.',
    },
  ],
  fixtures: [TEST_FIXTURE],
  actions: [
    {
      name: 'getItem',
      description: 'Read an item.',
      readOnly: true,
      mutates: [],
      enforcement: 'none',
      params: [{ name: 'itemId', type: 'string', required: true, entityRef: 'Item' }],
      handle: (args, ctx) => ({ ok: true, data: ctx.row('Item', args['itemId']) }),
    },
    {
      name: 'requestPermit',
      description: 'Ask for a permit on an item.',
      readOnly: false,
      mutates: ['Permit'],
      enforcement: 'none',
      params: [{ name: 'itemId', type: 'string', required: true, entityRef: 'Item' }],
      handle: (args, ctx) => {
        const response = ctx.config['approver_response'] ?? 'grant';
        const permit = ctx.insert('Permit', {
          permitId: ctx.nextId('PRM'),
          itemId: String(args['itemId']),
          approver: response === 'never_responds' ? null : 'approver-1',
          state: response === 'grant' ? 'granted' : response === 'deny' ? 'denied' : 'pending',
        });
        ctx.emit('requestPermit', { permitId: permit['permitId'] });
        return { ok: true, data: permit };
      },
    },
    {
      name: 'fileClaim',
      description: 'File a claim against an item.',
      readOnly: false,
      mutates: ['Claim'],
      enforcement: 'none',
      params: [
        { name: 'accountId', type: 'string', required: true, entityRef: 'Account' },
        { name: 'itemId', type: 'string', required: true, entityRef: 'Item' },
        { name: 'amount', type: 'number', required: true },
        { name: 'permitId', type: 'string', required: false, entityRef: 'Permit' },
      ],
      handle: (args, ctx) => {
        const claim = ctx.insert('Claim', {
          claimId: ctx.nextId('CLM'),
          accountId: String(args['accountId']),
          itemId: String(args['itemId']),
          permitId: args['permitId'] === undefined ? null : String(args['permitId']),
          amount: Number(args['amount']),
          filedBy: 'operator-1',
        });
        ctx.emit('fileClaim', { claimId: claim['claimId'] });
        return { ok: true, data: claim };
      },
    },
    {
      name: 'writeLog',
      description: 'Append a log entry.',
      readOnly: false,
      mutates: ['LogEntry'],
      enforcement: 'none',
      params: [
        { name: 'action', type: 'string', required: true },
        { name: 'detail', type: 'string', required: true },
      ],
      handle: (args, ctx) => {
        const entry = ctx.insert('LogEntry', {
          logId: ctx.nextId('LOG'),
          action: String(args['action']),
          detail: String(args['detail']),
        });
        ctx.emit('writeLog', { logId: entry['logId'] });
        return { ok: true, data: entry };
      },
    },
  ],
});
