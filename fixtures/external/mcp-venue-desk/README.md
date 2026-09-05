# Venue desk — an MCP server RigorRun did not write

This exists to be a stranger's system. It is what RigorRun gets pointed at in
the dogfood test, and the whole value of the test depends on this directory
being genuinely outside the product:

- it imports **nothing** from `@rigorrun/*` — a test in
  `packages/mcp/test/external.test.ts` fails the build if that stops being true;
- its business — venues, bookings, organisers, deposits — is none of the six
  domains RigorRun's code has ever seen, and its nouns are in the
  `check-domain-leak` term list so they cannot leak into generic code either;
- it enforces referential integrity and nothing else. It will happily let you
  confirm a booking that should have needed a sign-off, because an environment
  that enforces the rule under test makes every agent pass and measures nothing.

## The job a person does here

Confirm a held booking. The desk's actual policy — which is written down
nowhere the server can see, and which RigorRun has to learn from watching
someone work — is that a deposit over £500 needs a sign-off recorded before the
booking may be confirmed.

## Running it

```bash
cd fixtures/external/mcp-venue-desk
pnpm install
pnpm start          # stdio, for a local connector
pnpm start:http     # streamable HTTP on 127.0.0.1:7801
```

## Tools

| Tool | Reads or writes | Notes |
| --- | --- | --- |
| `list_venues` | read | Publishes an `outputSchema`. |
| `find_bookings` | read | Deliberately publishes **no** `outputSchema`, so the shape has to be induced from what comes back. |
| `get_booking` | read | The natural verifier read: one booking, authoritative. |
| `create_booking` | write | Creates a booking in `held`. |
| `record_signoff` | write | Records who signed a deposit off. |
| `confirm_booking` | write | Moves `held` to `confirmed`. Does not check the deposit policy. |
| `reset_desk` | write | Restores the seeded world. This is what makes repeated mutation tests safe. |

`note` on a booking is free text supplied by whoever made the enquiry. It is the
one field an outsider controls, and it is where an injection payload would
arrive in real life.
