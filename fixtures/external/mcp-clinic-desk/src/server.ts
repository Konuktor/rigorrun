import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { ClinicDb, type DbResult } from './db.ts';
import type { Principal } from './seed.ts';

const readAnnotations = { readOnlyHint: true, idempotentHint: true, openWorldHint: false };

function payload(value: unknown) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(value) }],
    structuredContent: value as Record<string, unknown>,
  };
}

function failure(message: string) {
  return { content: [{ type: 'text' as const, text: message }], isError: true };
}

function result<T>(entry: DbResult<T>, wrap?: (value: T) => unknown) {
  return entry.ok ? payload(wrap ? wrap(entry.value) : entry.value) : failure(entry.message);
}

export function createClinicServer(
  principal: Principal | undefined,
  db: ClinicDb = new ClinicDb(),
): McpServer {
  const server = new McpServer(
    { name: 'clinic-desk', version: '1.0.0' },
    { capabilities: { tools: {} } },
  );

  server.registerTool(
    'whoami',
    {
      description: 'The API key identity and role for this connection.',
      inputSchema: {},
      annotations: readAnnotations,
    },
    async () => (principal ? payload(db.whoami(principal)) : failure('unauthorized')),
  );

  server.registerTool(
    'search_patients',
    {
      description: 'Search patients by name.',
      inputSchema: { name: z.string() },
      annotations: readAnnotations,
    },
    async ({ name }) =>
      principal
        ? payload({ patients: db.searchPatients(principal, name) })
        : failure('unauthorized'),
  );

  server.registerTool(
    'get_patient',
    {
      description: 'Get one patient by id.',
      inputSchema: { patient_id: z.string() },
      annotations: readAnnotations,
    },
    async ({ patient_id }) =>
      principal ? result(db.getPatient(principal, patient_id)) : failure('unauthorized'),
  );

  server.registerTool(
    'list_appointments',
    {
      description: 'List appointments for one patient.',
      inputSchema: { patient_id: z.string() },
      annotations: readAnnotations,
    },
    async ({ patient_id }) =>
      principal
        ? result(db.listAppointments(principal, patient_id), (appointments) => ({ appointments }))
        : failure('unauthorized'),
  );

  server.registerTool(
    'reschedule_appointment',
    {
      description: 'Change an appointment start time.',
      inputSchema: { appointment_id: z.string(), starts_at: z.string() },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    async ({ appointment_id, starts_at }) =>
      principal
        ? result(db.rescheduleAppointment(principal, appointment_id, starts_at))
        : failure('unauthorized'),
  );

  server.registerTool(
    'cancel_appointment',
    {
      description: 'Cancel an appointment.',
      inputSchema: { appointment_id: z.string() },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    },
    async ({ appointment_id }) =>
      principal ? result(db.cancelAppointment(principal, appointment_id)) : failure('unauthorized'),
  );

  server.registerTool(
    'get_clinical_notes',
    {
      description: 'Get the clinical notes for one patient.',
      inputSchema: { patient_id: z.string() },
      annotations: readAnnotations,
    },
    async ({ patient_id }) =>
      principal
        ? result(db.getClinicalNotes(principal, patient_id), (clinical_notes) => ({
            clinical_notes,
          }))
        : failure('unauthorized'),
  );

  server.registerTool(
    'add_clinical_note',
    {
      description: 'Add a clinical note to one patient.',
      inputSchema: { patient_id: z.string(), text: z.string() },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    async ({ patient_id, text }) =>
      principal ? result(db.addClinicalNote(principal, patient_id, text)) : failure('unauthorized'),
  );

  server.registerTool(
    'list_invoices',
    {
      description: 'List invoices, optionally for one patient.',
      inputSchema: { patient_id: z.string().optional() },
      annotations: readAnnotations,
    },
    async ({ patient_id }) =>
      principal
        ? result(db.listInvoices(principal, patient_id), (invoices) => ({ invoices }))
        : failure('unauthorized'),
  );

  server.registerTool(
    'refund_invoice',
    {
      description: 'Refund part or all of a paid invoice.',
      inputSchema: { invoice_id: z.string(), amount_minor: z.number().int() },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
    },
    async ({ invoice_id, amount_minor }) =>
      principal
        ? result(db.refundInvoice(principal, invoice_id, amount_minor))
        : failure('unauthorized'),
  );

  server.registerTool(
    'send_message',
    {
      description: 'Send an SMS or email message.',
      inputSchema: { channel: z.enum(['sms', 'email']), to: z.string(), body: z.string() },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    async ({ channel, to, body }) =>
      principal ? payload(db.sendMessage(principal, channel, to, body)) : failure('unauthorized'),
  );

  server.registerTool(
    'export_patients',
    {
      description: 'Export complete patient rows, optionally for one practice.',
      inputSchema: { practice_id: z.string().optional() },
      annotations: readAnnotations,
    },
    async ({ practice_id }) =>
      principal
        ? result(db.exportPatients(principal, practice_id), (patients) => ({ patients }))
        : failure('unauthorized'),
  );

  server.registerTool(
    'delete_patient',
    {
      description: 'Delete a patient who has no dependent records.',
      inputSchema: { patient_id: z.string() },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    },
    async ({ patient_id }) =>
      principal ? result(db.deletePatient(principal, patient_id)) : failure('unauthorized'),
  );

  return server;
}
