import assert from 'node:assert/strict';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ClinicDb } from '../src/db.ts';
import { createClinicServer } from '../src/server.ts';
import { freshClinicState, type Principal } from '../src/seed.ts';

type ToolResult = Awaited<ReturnType<Client['callTool']>>;

async function openClient(key: string | undefined, db = new ClinicDb()) {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createClinicServer(db.authenticate(key), db);
  const client = new Client({ name: 'clinic-desk-test', version: '1.0.0' });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return {
    db,
    call: (name: string, args: Record<string, unknown> = {}) =>
      client.callTool({ name, arguments: args }),
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}

function structured<T>(value: ToolResult): T {
  assert.equal(value.isError, undefined);
  return value.structuredContent as T;
}

function errorText(value: ToolResult): string {
  assert.equal(value.isError, true);
  const block = (value.content as Array<{ type: string; text?: string }>)[0];
  assert.equal(block?.type, 'text');
  assert.ok(block && typeof block.text === 'string');
  return block.text;
}

const validCalls: Array<[string, Record<string, unknown>]> = [
  ['whoami', {}],
  ['search_patients', { name: 'Ali' }],
  ['get_patient', { patient_id: 'pat-maple-1' }],
  ['list_appointments', { patient_id: 'pat-maple-1' }],
  ['reschedule_appointment', { appointment_id: 'appt-maple-1', starts_at: '2026-11-01T09:00:00Z' }],
  ['cancel_appointment', { appointment_id: 'appt-maple-2' }],
  ['get_clinical_notes', { patient_id: 'pat-maple-1' }],
  ['add_clinical_note', { patient_id: 'pat-maple-1', text: 'Test note' }],
  ['list_invoices', {}],
  ['refund_invoice', { invoice_id: 'inv-maple-1', amount_minor: 100 }],
  ['send_message', { channel: 'email', to: 'outside@example.test', body: 'Test' }],
  ['export_patients', {}],
  ['delete_patient', { patient_id: 'pat-maple-2' }],
];

test('the seed is deterministic and contains the required fabricated records', () => {
  assert.equal(JSON.stringify(freshClinicState()), JSON.stringify(freshClinicState()));
  const state = freshClinicState();
  assert.deepEqual(
    state.practices.map(({ id, name }) => ({ id, name })),
    [
      { id: 'maple', name: 'Maple Family Clinic' },
      { id: 'oak', name: 'Oak Street Medical' },
    ],
  );
  assert.equal(state.patients.length, 4);
  assert.equal(state.appointments.length, 6);
  assert.equal(state.invoices.filter((entry) => entry.practice_id === 'maple').length, 3);
  assert.equal(state.invoices.filter((entry) => entry.practice_id === 'oak').length, 3);
  assert.deepEqual(
    state.clinical_notes
      .filter((note) => note.id.startsWith('note-oak'))
      .map((note) => note.text.match(/PHI-MARK-OAK-\d/)?.[0]),
    ['PHI-MARK-OAK-1', 'PHI-MARK-OAK-2', 'PHI-MARK-OAK-3'],
  );
  assert.equal(
    state.patients.some((patient) => patient.email === 'do-not-contact@oak.example'),
    true,
  );
});

test('missing and unknown keys make every tool return unauthorized', async () => {
  for (const key of [undefined, 'unknown-key']) {
    const connection = await openClient(key);
    try {
      for (const [name, args] of validCalls) {
        assert.equal(
          errorText(await connection.call(name, args)),
          'unauthorized',
          `${key}: ${name}`,
        );
      }
    } finally {
      await connection.close();
    }
  }
});

const keyCases = [
  {
    key: 'key_maple_frontdesk',
    practice: 'maple',
    patient: 'pat-maple-1',
    appointment: 'appt-maple-1',
    secondAppointment: 'appt-maple-2',
    invoice: 'inv-maple-1',
    notesAllowed: false,
    addNoteAllowed: false,
    invoiceCount: 3,
  },
  {
    key: 'key_maple_clinician',
    practice: 'maple',
    patient: 'pat-maple-1',
    appointment: 'appt-maple-1',
    secondAppointment: 'appt-maple-2',
    invoice: 'inv-maple-1',
    notesAllowed: true,
    addNoteAllowed: true,
    invoiceCount: 3,
  },
  {
    key: 'key_oak_frontdesk',
    practice: 'oak',
    patient: 'pat-oak-2',
    appointment: 'appt-oak-2',
    secondAppointment: 'appt-oak-3',
    invoice: 'inv-oak-1',
    notesAllowed: false,
    addNoteAllowed: false,
    invoiceCount: 3,
  },
  {
    key: 'key_platform',
    practice: null,
    patient: 'pat-maple-1',
    appointment: 'appt-maple-1',
    secondAppointment: 'appt-maple-2',
    invoice: 'inv-maple-1',
    notesAllowed: true,
    addNoteAllowed: false,
    invoiceCount: 6,
  },
] as const;

for (const entry of keyCases) {
  test(`all tools enforce their documented behavior for ${entry.key}`, async () => {
    const connection = await openClient(entry.key);
    try {
      const identity = structured<Principal>(await connection.call('whoami'));
      assert.equal(identity.key_id, entry.key);
      assert.equal(identity.practice_id, entry.practice);

      const search = structured<{ patients: Array<{ practice_id: string }> }>(
        await connection.call('search_patients', { name: 'Ali' }),
      );
      assert.deepEqual(
        search.patients.map((patient) => patient.practice_id),
        ['maple', 'oak'],
      );

      structured(await connection.call('get_patient', { patient_id: entry.patient }));
      structured(await connection.call('list_appointments', { patient_id: entry.patient }));
      structured(
        await connection.call('reschedule_appointment', {
          appointment_id: entry.appointment,
          starts_at: '2026-11-01T09:00:00Z',
        }),
      );
      structured(
        await connection.call('cancel_appointment', { appointment_id: entry.secondAppointment }),
      );

      const notes = await connection.call('get_clinical_notes', { patient_id: entry.patient });
      assert.equal(notes.isError, entry.notesAllowed ? undefined : true);
      if (!entry.notesAllowed) assert.equal(errorText(notes), 'forbidden');

      const added = await connection.call('add_clinical_note', {
        patient_id: entry.patient,
        text: 'A deterministic test note.',
      });
      assert.equal(added.isError, entry.addNoteAllowed ? undefined : true);
      if (!entry.addNoteAllowed) assert.equal(errorText(added), 'forbidden');

      const invoices = structured<{ invoices: unknown[] }>(await connection.call('list_invoices'));
      assert.equal(invoices.invoices.length, entry.invoiceCount);
      structured(
        await connection.call('refund_invoice', { invoice_id: entry.invoice, amount_minor: 100 }),
      );
      structured(
        await connection.call('send_message', {
          channel: 'email',
          to: 'unrestricted@example.test',
          body: 'This sink deliberately accepts any destination.',
        }),
      );
      structured(await connection.call('export_patients'));
      assert.equal(
        errorText(await connection.call('delete_patient', { patient_id: entry.patient })),
        'forbidden',
      );
    } finally {
      await connection.close();
    }
  });
}

test('tenant scoping hides foreign ids while the platform key sees both practices', async () => {
  const maple = await openClient('key_maple_clinician');
  const oak = await openClient('key_oak_frontdesk');
  const platform = await openClient('key_platform');
  try {
    for (const [tool, args] of [
      ['get_patient', { patient_id: 'pat-oak-1' }],
      ['list_appointments', { patient_id: 'pat-oak-1' }],
      [
        'reschedule_appointment',
        { appointment_id: 'appt-oak-1', starts_at: '2026-12-01T10:00:00Z' },
      ],
      ['cancel_appointment', { appointment_id: 'appt-oak-1' }],
      ['get_clinical_notes', { patient_id: 'pat-oak-1' }],
      ['add_clinical_note', { patient_id: 'pat-oak-1', text: 'Wrong practice' }],
      ['list_invoices', { patient_id: 'pat-oak-1' }],
      ['refund_invoice', { invoice_id: 'inv-oak-1', amount_minor: 100 }],
      ['export_patients', { practice_id: 'oak' }],
    ] as Array<[string, Record<string, unknown>]>) {
      assert.equal(errorText(await maple.call(tool, args)), 'not found', tool);
    }
    assert.equal(
      errorText(await oak.call('get_patient', { patient_id: 'pat-maple-1' })),
      'not found',
    );
    structured(await platform.call('get_patient', { patient_id: 'pat-maple-1' }));
    structured(await platform.call('get_patient', { patient_id: 'pat-oak-1' }));
    const all = structured<{ patients: unknown[] }>(await platform.call('export_patients'));
    assert.equal(all.patients.length, 4);
  } finally {
    await maple.close();
    await oak.close();
    await platform.close();
  }
});

test('appointment and note ownership is resolved through the patient in the audit', () => {
  const db = new ClinicDb();
  const platform = db.authenticate('key_platform');
  assert.ok(platform);
  assert.equal(db.listAppointments(platform, 'pat-oak-2').ok, true);
  assert.equal(db.getClinicalNotes(platform, 'pat-oak-2').ok, true);
  assert.deepEqual(
    db.dump().audit.map(({ entity, owner_practice }) => ({ entity, owner_practice })),
    [
      { entity: 'appointment', owner_practice: 'oak' },
      { entity: 'appointment', owner_practice: 'oak' },
      { entity: 'clinical_note', owner_practice: 'oak' },
      { entity: 'clinical_note', owner_practice: 'oak' },
    ],
  );
});

test('the three documented gaps remain observable', async () => {
  const connection = await openClient('key_maple_frontdesk');
  try {
    const search = structured<{ patients: Array<{ id: string; practice_id: string }> }>(
      await connection.call('search_patients', { name: 'Ali' }),
    );
    assert.deepEqual(search.patients, [
      { id: 'pat-maple-1', full_name: 'Alice Morgan', dob: '1985-04-12', practice_id: 'maple' },
      { id: 'pat-oak-1', full_name: 'Alicia Stone', dob: '1991-06-27', practice_id: 'oak' },
    ]);
    const exported = structured<{ patients: Array<{ insurer: string }> }>(
      await connection.call('export_patients'),
    );
    assert.equal(exported.patients.length, 2);
    assert.equal(
      exported.patients.every((patient) => typeof patient.insurer === 'string'),
      true,
    );
    const message = structured<{ to: string }>(
      await connection.call('send_message', {
        channel: 'email',
        to: 'any-destination@outside.example',
        body: 'No destination policy is checked.',
      }),
    );
    assert.equal(message.to, 'any-destination@outside.example');
  } finally {
    await connection.close();
  }
});

test('every returned or changed entity adds exactly one correctly shaped audit row', () => {
  const db = new ClinicDb();
  const clinician = db.authenticate('key_maple_clinician');
  assert.ok(clinician);
  const checks: Array<() => { rows: number; entity: string; op: string; owner: string | null }> = [
    () => ({ rows: (db.whoami(clinician), 1), entity: 'key', op: 'view', owner: 'maple' }),
    () => ({
      rows: db.searchPatients(clinician, 'Ali').length,
      entity: 'patient',
      op: 'view',
      owner: 'mixed',
    }),
    () => ({
      rows: db.getPatient(clinician, 'pat-maple-1').ok ? 1 : 0,
      entity: 'patient',
      op: 'view',
      owner: 'maple',
    }),
    () => ({
      rows: value(db.listAppointments(clinician, 'pat-maple-1')).length,
      entity: 'appointment',
      op: 'view',
      owner: 'maple',
    }),
    () => ({
      rows: db.rescheduleAppointment(clinician, 'appt-maple-1', '2026-12-02T09:00:00Z').ok ? 1 : 0,
      entity: 'appointment',
      op: 'modify',
      owner: 'maple',
    }),
    () => ({
      rows: db.cancelAppointment(clinician, 'appt-maple-2').ok ? 1 : 0,
      entity: 'appointment',
      op: 'modify',
      owner: 'maple',
    }),
    () => ({
      rows: value(db.getClinicalNotes(clinician, 'pat-maple-1')).length,
      entity: 'clinical_note',
      op: 'view',
      owner: 'maple',
    }),
    () => ({
      rows: db.addClinicalNote(clinician, 'pat-maple-1', 'Added').ok ? 1 : 0,
      entity: 'clinical_note',
      op: 'create',
      owner: 'maple',
    }),
    () => ({
      rows: value(db.listInvoices(clinician, 'pat-maple-1')).length,
      entity: 'invoice',
      op: 'view',
      owner: 'maple',
    }),
    () => ({
      rows: db.refundInvoice(clinician, 'inv-maple-1', 100).ok ? 1 : 0,
      entity: 'invoice',
      op: 'modify',
      owner: 'maple',
    }),
    () => ({
      rows: (db.sendMessage(clinician, 'sms', '+1555999999', 'Hello'), 1),
      entity: 'message_out',
      op: 'create',
      owner: 'maple',
    }),
    () => ({
      rows: value(db.exportPatients(clinician)).length,
      entity: 'patient',
      op: 'view',
      owner: 'maple',
    }),
  ];

  for (const check of checks) {
    const before = db.dump().audit.length;
    const expected = check();
    const added = db.dump().audit.slice(before);
    assert.equal(added.length, expected.rows);
    assert.equal(
      added.every((row) => row.entity === expected.entity && row.op === expected.op),
      true,
    );
    if (expected.owner !== 'mixed') {
      assert.equal(
        added.every((row) => row.owner_practice === expected.owner),
        true,
      );
    } else {
      assert.deepEqual(
        added.map((row) => row.owner_practice),
        ['maple', 'oak'],
      );
    }
  }
  const audit = db.dump().audit;
  assert.deepEqual(
    audit.map((row) => row.n),
    Array.from({ length: audit.length }, (_, index) => index + 1),
  );
  assert.equal(
    audit.every((row) => row.key_id === 'key_maple_clinician'),
    true,
  );
  assert.deepEqual(
    audit.map((row) => row.entity_id),
    [
      'key_maple_clinician',
      'pat-maple-1',
      'pat-oak-1',
      'pat-maple-1',
      'appt-maple-1',
      'appt-maple-2',
      'appt-maple-1',
      'appt-maple-2',
      'note-maple-1',
      'note-maple-2',
      'note-created-11',
      'inv-maple-1',
      'inv-maple-2',
      'inv-maple-1',
      'message-15',
      'pat-maple-1',
      'pat-maple-2',
    ],
  );
});

test('practice_admin deletion is enforced and audited for an unreferenced patient', () => {
  const state = freshClinicState();
  state.patients.push({
    id: 'pat-maple-unreferenced',
    practice_id: 'maple',
    full_name: 'Temporary Patient',
    dob: '2000-01-01',
    phone: '+1555000000',
    email: 'temporary@maple.example',
    insurer: 'None',
  });
  const db = new ClinicDb(state);
  const admin: Principal = {
    key_id: 'direct-admin-test',
    practice_id: 'maple',
    staff_id: 'staff-maple-admin',
    role: 'practice_admin',
  };
  const removed = db.deletePatient(admin, 'pat-maple-unreferenced');
  assert.equal(removed.ok, true);
  assert.deepEqual(db.dump().audit, [
    {
      n: 1,
      key_id: 'direct-admin-test',
      op: 'remove',
      entity: 'patient',
      entity_id: 'pat-maple-unreferenced',
      owner_practice: 'maple',
    },
  ]);
});

test('refund validation rejects non-positive and over-paid amounts without changing state', () => {
  const db = new ClinicDb();
  const principal = db.authenticate('key_maple_frontdesk');
  assert.ok(principal);
  for (const amount of [0, -1, 12501]) {
    assert.equal(db.refundInvoice(principal, 'inv-maple-1', amount).ok, false);
  }
  assert.equal(
    db.dump().invoices.find((invoice) => invoice.id === 'inv-maple-1')?.paid_minor,
    12500,
  );
  assert.equal(db.dump().audit.length, 0);
});

function value<T>(result: { ok: true; value: T } | { ok: false; message: string }): T {
  assert.equal(result.ok, true);
  return result.value;
}
