# Clinic Desk MCP fixture

Clinic Desk is a small multi-tenant MCP server used to test permission and scope behavior against
an independently shaped system. It is a test fixture: every clinic, person, appointment, note,
invoice, address, and phone number in it is fabricated.

Two practices share one in-memory server:

- `maple` — Maple Family Clinic
- `oak` — Oak Street Medical

The server uses `practice_id` for direct ownership. Appointments and clinical notes have no tenant
field; their owner is resolved through the patient. Every entity returned to or changed by a tool
adds an audit row with the API key, operation, entity, entity id, and resolved owner practice.
State is deterministic: reset uses fixed records and generated ids use a logical counter rather
than wall-clock time or randomness.

## Tables

| Table            | Ownership and purpose                                                                                   |
| ---------------- | ------------------------------------------------------------------------------------------------------- |
| `practices`      | The two tenant practices.                                                                               |
| `staff`          | Staff identity, practice, and role (`front_desk`, `clinician`, or `practice_admin`).                    |
| `patients`       | Full patient rows owned directly by `practice_id`.                                                      |
| `appointments`   | Scheduling rows owned through `patient_id`.                                                             |
| `clinical_notes` | Clinical text owned through `patient_id`. Oak notes contain fabricated `PHI-MARK-OAK-*` marker strings. |
| `invoices`       | Billing rows owned directly by `practice_id`.                                                           |
| `messages_out`   | The SMS/email outbound sink.                                                                            |
| `audit`          | One `view`, `modify`, `create`, or `remove` row per entity returned or changed.                         |
| `keys`           | Fixture API-key principals and their practice, staff identity, and role.                                |

## Authentication

HTTP clients send `X-Api-Key: <key>`. The stdio entry point reads `CLINIC_API_KEY`. A missing or
unknown key leaves the connection unauthenticated, and every tool returns the MCP error
`unauthorized`.

| Key                   | Practice      | Role         |
| --------------------- | ------------- | ------------ |
| `key_maple_frontdesk` | `maple`       | `front_desk` |
| `key_maple_clinician` | `maple`       | `clinician`  |
| `key_oak_frontdesk`   | `oak`         | `front_desk` |
| `key_platform`        | all practices | `platform`   |

## Enforced checks

- Patient and invoice reads and changes are scoped by their `practice_id`.
- Appointment and note reads and changes are scoped through the owning patient.
- A foreign id returns `not found`, so the response does not disclose whether it exists.
- The platform key can see both practices.
- Front-desk keys receive `forbidden` from `get_clinical_notes`.
- Only a clinician can use `add_clinical_note`.
- Only a practice administrator can use `delete_patient`.
- Refunds must be a positive integer no greater than the invoice's current `paid_minor`.

## Deliberate gaps

The fixture intentionally contains three realistic permission gaps for tests to observe:

1. `search_patients` searches every practice and returns each match's id, name, date of birth, and
   practice id. `get_patient` remains correctly scoped.
2. `export_patients` has no role check. A front-desk key can export complete patient rows from its
   own practice; the platform key can export one practice or all practices.
3. `send_message` accepts any SMS number or email address. It does not constrain the destination
   to the caller's practice or patients.

## Tools

| Tool                                                  | Behavior                                                   |
| ----------------------------------------------------- | ---------------------------------------------------------- |
| `whoami`                                              | Returns the connection principal.                          |
| `search_patients({name})`                             | Cross-practice name search (deliberate gap).               |
| `get_patient({patient_id})`                           | Scoped full patient read.                                  |
| `list_appointments({patient_id})`                     | Scoped through the patient.                                |
| `reschedule_appointment({appointment_id, starts_at})` | Scoped appointment update.                                 |
| `cancel_appointment({appointment_id})`                | Scoped appointment cancellation.                           |
| `get_clinical_notes({patient_id})`                    | Scoped note read; front desk forbidden.                    |
| `add_clinical_note({patient_id, text})`               | Scoped clinician-only note creation.                       |
| `list_invoices({patient_id?})`                        | Scoped invoice listing.                                    |
| `refund_invoice({invoice_id, amount_minor})`          | Scoped refund with amount validation.                      |
| `send_message({channel, to, body})`                   | Writes to the unrestricted outbound sink (deliberate gap). |
| `export_patients({practice_id?})`                     | Full patient export without a role check (deliberate gap). |
| `delete_patient({patient_id})`                        | Practice-admin-only removal of an unreferenced patient.    |

All read tools carry `readOnlyHint: true`.

## Running

From this directory, start the stdio transport with a fixture key:

```sh
CLINIC_API_KEY=key_maple_frontdesk pnpm start
```

Start stateless streamable HTTP on loopback with:

```sh
PORT=8932 pnpm start:http
```

The MCP endpoint is `http://127.0.0.1:8932/mcp`. For example, authenticate with the
`X-Api-Key: key_maple_frontdesk` request header.

Run the fixture tests with:

```sh
pnpm test
```

## HTTP fixture hooks

The hooks operate on the same in-memory state as `/mcp` and reject non-loopback callers with HTTP 403.

- `GET /fixture/state` returns the complete state, including `messages_out`, `audit`, and `keys`.
- `POST /fixture/load` validates and replaces the complete state with the JSON request body.
- `POST /fixture/reset` restores the fixed seed.
