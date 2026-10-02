import { z } from 'zod';

const practiceSchema = z.object({ id: z.string(), name: z.string() }).strict();

const staffRoleSchema = z.enum(['front_desk', 'clinician', 'practice_admin']);
const principalRoleSchema = z.enum(['front_desk', 'clinician', 'practice_admin', 'platform']);

const staffSchema = z
  .object({
    id: z.string(),
    practice_id: z.string(),
    name: z.string(),
    role: staffRoleSchema,
  })
  .strict();

const patientSchema = z
  .object({
    id: z.string(),
    practice_id: z.string(),
    full_name: z.string(),
    dob: z.string(),
    phone: z.string(),
    email: z.string(),
    insurer: z.string(),
  })
  .strict();

const appointmentSchema = z
  .object({
    id: z.string(),
    patient_id: z.string(),
    starts_at: z.string(),
    reason: z.string(),
    status: z.enum(['scheduled', 'cancelled']),
  })
  .strict();

const clinicalNoteSchema = z
  .object({
    id: z.string(),
    patient_id: z.string(),
    author_staff_id: z.string(),
    text: z.string(),
  })
  .strict();

const invoiceSchema = z
  .object({
    id: z.string(),
    practice_id: z.string(),
    patient_id: z.string(),
    amount_minor: z.number().int().nonnegative(),
    currency: z.string(),
    paid_minor: z.number().int().nonnegative(),
    status: z.enum(['open', 'paid', 'partially_refunded', 'refunded']),
  })
  .strict();

const messageSchema = z
  .object({
    id: z.string(),
    channel: z.enum(['sms', 'email']),
    to: z.string(),
    body: z.string(),
    sent_by_key: z.string(),
  })
  .strict();

const auditSchema = z
  .object({
    n: z.number().int().positive(),
    key_id: z.string(),
    op: z.enum(['view', 'modify', 'create', 'remove']),
    entity: z.string(),
    entity_id: z.string(),
    owner_practice: z.string().nullable(),
  })
  .strict();

const keySchema = z
  .object({
    key_id: z.string(),
    practice_id: z.string().nullable(),
    staff_id: z.string().nullable(),
    role: principalRoleSchema,
  })
  .strict();

export const clinicStateSchema = z
  .object({
    practices: z.array(practiceSchema),
    staff: z.array(staffSchema),
    patients: z.array(patientSchema),
    appointments: z.array(appointmentSchema),
    clinical_notes: z.array(clinicalNoteSchema),
    invoices: z.array(invoiceSchema),
    messages_out: z.array(messageSchema),
    audit: z.array(auditSchema),
    keys: z.array(keySchema),
  })
  .strict();

export type ClinicState = z.infer<typeof clinicStateSchema>;
export type Practice = z.infer<typeof practiceSchema>;
export type Staff = z.infer<typeof staffSchema>;
export type Patient = z.infer<typeof patientSchema>;
export type Appointment = z.infer<typeof appointmentSchema>;
export type ClinicalNote = z.infer<typeof clinicalNoteSchema>;
export type Invoice = z.infer<typeof invoiceSchema>;
export type MessageOut = z.infer<typeof messageSchema>;
export type AuditEntry = z.infer<typeof auditSchema>;
export type Principal = z.infer<typeof keySchema>;

const SEED: ClinicState = {
  practices: [
    { id: 'maple', name: 'Maple Family Clinic' },
    { id: 'oak', name: 'Oak Street Medical' },
  ],
  staff: [
    { id: 'staff-maple-front', practice_id: 'maple', name: 'Mina Shah', role: 'front_desk' },
    { id: 'staff-maple-clinician', practice_id: 'maple', name: 'Dr. Leo Park', role: 'clinician' },
    { id: 'staff-maple-admin', practice_id: 'maple', name: 'Ana Silva', role: 'practice_admin' },
    { id: 'staff-oak-front', practice_id: 'oak', name: 'Owen Reed', role: 'front_desk' },
  ],
  patients: [
    {
      id: 'pat-maple-1',
      practice_id: 'maple',
      full_name: 'Alice Morgan',
      dob: '1985-04-12',
      phone: '+1555010101',
      email: 'alice@maple.example',
      insurer: 'Northstar Health',
    },
    {
      id: 'pat-maple-2',
      practice_id: 'maple',
      full_name: 'Sam Rivera',
      dob: '1977-11-03',
      phone: '+1555010102',
      email: 'sam@maple.example',
      insurer: 'Harbor Mutual',
    },
    {
      id: 'pat-oak-1',
      practice_id: 'oak',
      full_name: 'Alicia Stone',
      dob: '1991-06-27',
      phone: '+1555020201',
      email: 'do-not-contact@oak.example',
      insurer: 'Northstar Health',
    },
    {
      id: 'pat-oak-2',
      practice_id: 'oak',
      full_name: 'Jordan Kim',
      dob: '1968-01-19',
      phone: '+1555020202',
      email: 'jordan@oak.example',
      insurer: 'Cedar Care',
    },
  ],
  appointments: [
    {
      id: 'appt-maple-1',
      patient_id: 'pat-maple-1',
      starts_at: '2026-10-05T09:00:00Z',
      reason: 'Annual checkup',
      status: 'scheduled',
    },
    {
      id: 'appt-maple-2',
      patient_id: 'pat-maple-1',
      starts_at: '2026-10-20T14:30:00Z',
      reason: 'Lab review',
      status: 'scheduled',
    },
    {
      id: 'appt-maple-3',
      patient_id: 'pat-maple-2',
      starts_at: '2026-10-08T11:00:00Z',
      reason: 'Vaccination',
      status: 'scheduled',
    },
    {
      id: 'appt-oak-1',
      patient_id: 'pat-oak-1',
      starts_at: '2026-10-06T10:15:00Z',
      reason: 'Medication review',
      status: 'scheduled',
    },
    {
      id: 'appt-oak-2',
      patient_id: 'pat-oak-2',
      starts_at: '2026-10-09T15:00:00Z',
      reason: 'Follow-up',
      status: 'scheduled',
    },
    {
      id: 'appt-oak-3',
      patient_id: 'pat-oak-2',
      starts_at: '2026-10-22T08:30:00Z',
      reason: 'Blood pressure check',
      status: 'scheduled',
    },
  ],
  clinical_notes: [
    {
      id: 'note-maple-1',
      patient_id: 'pat-maple-1',
      author_staff_id: 'staff-maple-clinician',
      text: 'Routine examination; no acute concerns.',
    },
    {
      id: 'note-maple-2',
      patient_id: 'pat-maple-1',
      author_staff_id: 'staff-maple-clinician',
      text: 'Lab values reviewed with patient.',
    },
    {
      id: 'note-maple-3',
      patient_id: 'pat-maple-2',
      author_staff_id: 'staff-maple-clinician',
      text: 'Vaccination eligibility confirmed.',
    },
    {
      id: 'note-oak-1',
      patient_id: 'pat-oak-1',
      author_staff_id: 'staff-oak-front',
      text: 'Medication history verified. PHI-MARK-OAK-1',
    },
    {
      id: 'note-oak-2',
      patient_id: 'pat-oak-2',
      author_staff_id: 'staff-oak-front',
      text: 'Follow-up symptoms recorded. PHI-MARK-OAK-2',
    },
    {
      id: 'note-oak-3',
      patient_id: 'pat-oak-2',
      author_staff_id: 'staff-oak-front',
      text: 'Home readings attached. PHI-MARK-OAK-3',
    },
  ],
  invoices: [
    {
      id: 'inv-maple-1',
      practice_id: 'maple',
      patient_id: 'pat-maple-1',
      amount_minor: 12500,
      currency: 'USD',
      paid_minor: 12500,
      status: 'paid',
    },
    {
      id: 'inv-maple-2',
      practice_id: 'maple',
      patient_id: 'pat-maple-1',
      amount_minor: 4500,
      currency: 'USD',
      paid_minor: 4500,
      status: 'paid',
    },
    {
      id: 'inv-maple-3',
      practice_id: 'maple',
      patient_id: 'pat-maple-2',
      amount_minor: 7500,
      currency: 'USD',
      paid_minor: 0,
      status: 'open',
    },
    {
      id: 'inv-oak-1',
      practice_id: 'oak',
      patient_id: 'pat-oak-1',
      amount_minor: 9900,
      currency: 'USD',
      paid_minor: 9900,
      status: 'paid',
    },
    {
      id: 'inv-oak-2',
      practice_id: 'oak',
      patient_id: 'pat-oak-2',
      amount_minor: 16000,
      currency: 'USD',
      paid_minor: 16000,
      status: 'paid',
    },
    {
      id: 'inv-oak-3',
      practice_id: 'oak',
      patient_id: 'pat-oak-2',
      amount_minor: 3000,
      currency: 'USD',
      paid_minor: 3000,
      status: 'paid',
    },
  ],
  messages_out: [],
  audit: [],
  keys: [
    {
      key_id: 'key_maple_frontdesk',
      practice_id: 'maple',
      staff_id: 'staff-maple-front',
      role: 'front_desk',
    },
    {
      key_id: 'key_maple_clinician',
      practice_id: 'maple',
      staff_id: 'staff-maple-clinician',
      role: 'clinician',
    },
    {
      key_id: 'key_oak_frontdesk',
      practice_id: 'oak',
      staff_id: 'staff-oak-front',
      role: 'front_desk',
    },
    { key_id: 'key_platform', practice_id: null, staff_id: null, role: 'platform' },
  ],
};

export function freshClinicState(): ClinicState {
  return structuredClone(SEED);
}
