import {
  clinicStateSchema,
  freshClinicState,
  type Appointment,
  type ClinicState,
  type ClinicalNote,
  type Invoice,
  type MessageOut,
  type Patient,
  type Principal,
} from './seed.ts';

export type DbResult<T> = { ok: true; value: T } | { ok: false; message: string };

export class ClinicDb {
  private state: ClinicState;

  constructor(state: ClinicState = freshClinicState()) {
    this.state = clinicStateSchema.parse(structuredClone(state));
  }

  dump(): ClinicState {
    return structuredClone(this.state);
  }

  load(value: unknown): ClinicState {
    this.state = clinicStateSchema.parse(value);
    return this.dump();
  }

  reset(): ClinicState {
    this.state = freshClinicState();
    return this.dump();
  }

  authenticate(key: string | undefined): Principal | undefined {
    const principal = this.state.keys.find((entry) => entry.key_id === key);
    return principal ? { ...principal } : undefined;
  }

  whoami(principal: Principal): Principal {
    this.record(principal, 'view', 'key', principal.key_id, principal.practice_id);
    return { ...principal };
  }

  searchPatients(
    principal: Principal,
    name: string,
  ): Array<Pick<Patient, 'id' | 'full_name' | 'dob' | 'practice_id'>> {
    const query = name.toLocaleLowerCase();
    const matches = this.state.patients
      .filter((patient) => patient.full_name.toLocaleLowerCase().includes(query))
      .map(({ id, full_name, dob, practice_id }) => ({ id, full_name, dob, practice_id }));
    for (const patient of matches)
      this.record(principal, 'view', 'patient', patient.id, patient.practice_id);
    return matches;
  }

  getPatient(principal: Principal, patientId: string): DbResult<Patient> {
    const patient = this.scopedPatient(principal, patientId);
    if (!patient) return missing();
    this.record(principal, 'view', 'patient', patient.id, patient.practice_id);
    return found(patient);
  }

  listAppointments(principal: Principal, patientId: string): DbResult<Appointment[]> {
    const patient = this.scopedPatient(principal, patientId);
    if (!patient) return missing();
    const appointments = this.state.appointments.filter((entry) => entry.patient_id === patientId);
    for (const appointment of appointments) {
      this.record(principal, 'view', 'appointment', appointment.id, patient.practice_id);
    }
    return found(appointments);
  }

  rescheduleAppointment(
    principal: Principal,
    appointmentId: string,
    startsAt: string,
  ): DbResult<Appointment> {
    const scoped = this.scopedAppointment(principal, appointmentId);
    if (!scoped) return missing();
    scoped.appointment.starts_at = startsAt;
    this.record(principal, 'modify', 'appointment', appointmentId, scoped.patient.practice_id);
    return found(scoped.appointment);
  }

  cancelAppointment(principal: Principal, appointmentId: string): DbResult<Appointment> {
    const scoped = this.scopedAppointment(principal, appointmentId);
    if (!scoped) return missing();
    scoped.appointment.status = 'cancelled';
    this.record(principal, 'modify', 'appointment', appointmentId, scoped.patient.practice_id);
    return found(scoped.appointment);
  }

  getClinicalNotes(principal: Principal, patientId: string): DbResult<ClinicalNote[]> {
    const patient = this.scopedPatient(principal, patientId);
    if (!patient) return missing();
    if (principal.role === 'front_desk') return forbidden();
    const notes = this.state.clinical_notes.filter((entry) => entry.patient_id === patientId);
    for (const note of notes)
      this.record(principal, 'view', 'clinical_note', note.id, patient.practice_id);
    return found(notes);
  }

  addClinicalNote(principal: Principal, patientId: string, text: string): DbResult<ClinicalNote> {
    const patient = this.scopedPatient(principal, patientId);
    if (!patient) return missing();
    if (principal.role !== 'clinician') return forbidden();
    if (!principal.staff_id) return forbidden();
    const note: ClinicalNote = {
      id: `note-created-${this.nextLogicalNumber()}`,
      patient_id: patientId,
      author_staff_id: principal.staff_id,
      text,
    };
    this.state.clinical_notes.push(note);
    this.record(principal, 'create', 'clinical_note', note.id, patient.practice_id);
    return found(note);
  }

  listInvoices(principal: Principal, patientId?: string): DbResult<Invoice[]> {
    if (patientId && !this.scopedPatient(principal, patientId)) return missing();
    const invoices = this.state.invoices.filter(
      (invoice) =>
        this.canAccess(principal, invoice.practice_id) &&
        (patientId === undefined || invoice.patient_id === patientId),
    );
    for (const invoice of invoices)
      this.record(principal, 'view', 'invoice', invoice.id, invoice.practice_id);
    return found(invoices);
  }

  refundInvoice(principal: Principal, invoiceId: string, amountMinor: number): DbResult<Invoice> {
    const invoice = this.state.invoices.find(
      (entry) => entry.id === invoiceId && this.canAccess(principal, entry.practice_id),
    );
    if (!invoice) return missing();
    if (!Number.isInteger(amountMinor) || amountMinor <= 0 || amountMinor > invoice.paid_minor) {
      return { ok: false, message: 'invalid refund amount' };
    }
    invoice.paid_minor -= amountMinor;
    invoice.status = invoice.paid_minor === 0 ? 'refunded' : 'partially_refunded';
    this.record(principal, 'modify', 'invoice', invoice.id, invoice.practice_id);
    return found(invoice);
  }

  sendMessage(
    principal: Principal,
    channel: 'sms' | 'email',
    to: string,
    body: string,
  ): MessageOut {
    const message: MessageOut = {
      id: `message-${this.nextLogicalNumber()}`,
      channel,
      to,
      body,
      sent_by_key: principal.key_id,
    };
    this.state.messages_out.push(message);
    this.record(principal, 'create', 'message_out', message.id, principal.practice_id);
    return { ...message };
  }

  exportPatients(principal: Principal, practiceId?: string): DbResult<Patient[]> {
    if (principal.role !== 'platform' && practiceId && practiceId !== principal.practice_id)
      return missing();
    const patients = this.state.patients.filter((patient) =>
      principal.role === 'platform'
        ? practiceId === undefined || patient.practice_id === practiceId
        : patient.practice_id === principal.practice_id,
    );
    for (const patient of patients)
      this.record(principal, 'view', 'patient', patient.id, patient.practice_id);
    return found(patients);
  }

  deletePatient(principal: Principal, patientId: string): DbResult<Patient> {
    const patient = this.scopedPatient(principal, patientId);
    if (!patient) return missing();
    if (principal.role !== 'practice_admin') return forbidden();
    const referenced =
      this.state.appointments.some((entry) => entry.patient_id === patientId) ||
      this.state.clinical_notes.some((entry) => entry.patient_id === patientId) ||
      this.state.invoices.some((entry) => entry.patient_id === patientId);
    if (referenced) return { ok: false, message: 'patient has dependent records' };
    this.state.patients = this.state.patients.filter((entry) => entry.id !== patientId);
    this.record(principal, 'remove', 'patient', patient.id, patient.practice_id);
    return found(patient);
  }

  private scopedPatient(principal: Principal, patientId: string): Patient | undefined {
    return this.state.patients.find(
      (patient) => patient.id === patientId && this.canAccess(principal, patient.practice_id),
    );
  }

  private scopedAppointment(
    principal: Principal,
    appointmentId: string,
  ): { appointment: Appointment; patient: Patient } | undefined {
    const appointment = this.state.appointments.find((entry) => entry.id === appointmentId);
    if (!appointment) return undefined;
    const patient = this.scopedPatient(principal, appointment.patient_id);
    return patient ? { appointment, patient } : undefined;
  }

  private canAccess(principal: Principal, practiceId: string): boolean {
    return principal.role === 'platform' || principal.practice_id === practiceId;
  }

  private nextLogicalNumber(): number {
    return this.state.audit.reduce((largest, entry) => Math.max(largest, entry.n), 0) + 1;
  }

  private record(
    principal: Principal,
    op: 'view' | 'modify' | 'create' | 'remove',
    entity: string,
    entityId: string,
    ownerPractice: string | null,
  ): void {
    this.state.audit.push({
      n: this.nextLogicalNumber(),
      key_id: principal.key_id,
      op,
      entity,
      entity_id: entityId,
      owner_practice: ownerPractice,
    });
  }
}

function found<T>(value: T): DbResult<T> {
  return { ok: true, value: structuredClone(value) };
}

function missing<T>(): DbResult<T> {
  return { ok: false, message: 'not found' };
}

function forbidden<T>(): DbResult<T> {
  return { ok: false, message: 'forbidden' };
}
