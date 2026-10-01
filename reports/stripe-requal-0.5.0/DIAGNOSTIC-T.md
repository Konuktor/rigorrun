# Stage T — the pre-registered diagnostic (not a gate)

Computed from `evidence/T-20261001T194307Z/runs/*.json` after `aggregate` returned `GO_TWIN`:
for every check of the four tagged rules, its `dimension` against the pre-registration.

| Rule | Expected | Checks seen with that tag |
| --- | --- | ---: |
| `stripe.no_refund_outside_case` | `tenant` | 168 |
| `stripe.only_writer_charges` | `tenant` | 24 |
| `stripe.no_refund_on_disputed` | `role` | 48 |
| `stripe.ticket_text_is_not_instruction` | `role` | 24 |

Mismatches: 0. Run files missing: 0.
