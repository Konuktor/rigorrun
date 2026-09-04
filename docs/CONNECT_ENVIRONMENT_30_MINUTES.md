# Point RigorRun at your own system

Target: half an hour from `pnpm add @rigorrun/environment` to a generated
benchmark. You write a schema, a handful of actions and one fixture. You do not
touch RigorRun.

## What you are actually providing

RigorRun never learns what your business is. It learns:

- **records** — what kinds exist, what fields they have, and what each field
  *means* structurally (an identifier, a quantity, a lifecycle status, a
  person, a gate, free text);
- **links** — which record names which other record;
- **actions** — what can be done, what arguments each takes, and what it writes to;
- **a starting world** — one realistic slice of data.

From that plus a recording of somebody working, it derives the rules, the
checks and the cases.

## 1. Scaffold

```bash
pnpm rigorrun init-environment my-system
```

Writes `environment.ts`, `schema.ts`, `fixture.ts` and a README into
`environments/my-system/`.

## 2. Describe your records

The only unusual part is `role`. RigorRun cannot tell from `{ name: 'amount',
type: 'number' }` whether a threshold rule would make sense, so you say.

```ts
import { entity, id, ref, money, status, actor, text, flag } from '@rigorrun/environments/kit';

entity('Order', 'orderId', [
  id('orderId'),
  ref('customerId'),                       // an identifier of another record
  money('total'),                          // a quantity: thresholds apply
  status('orderStatus', ['placed', 'shipped', 'cancelled']),
  flag('fraudHold'),                       // a gate: conditions apply
  actor('approvedBy'),                     // a person: separation-of-duties applies
  text('note', { untrusted: true }),       // written by someone outside your organisation
]);
```

`untrusted: true` is the one annotation with security weight. Those are the
only fields RigorRun will write an injection payload into.

A `quantity` or `timestamp` role needs a `unit` and a `precision`. Precision is
what makes "one more than the limit" mean 0.01 on money and 1 on a day count;
without it, boundary cases do not sit on the boundary. The helpers set both.

## 3. Describe the links

```ts
belongsTo('Order', 'customer', 'Customer', 'customerId', true); // required
hasMany('Customer', 'orders', 'Order', 'customerId');
```

The foreign key lives on whichever side has many rows. Cardinality says which.

## 4. Describe the actions

```ts
{
  name: 'shipOrder',
  description: 'Dispatch an order',
  readOnly: false,
  mutates: ['Shipment'],
  enforcement: 'none',
  params: [
    param('orderId', { entityRef: 'Order' }),
    param('quantity', { type: 'number' }),
  ],
  handle: (args, ctx) => { /* your system call */ },
}
```

**`enforcement: 'none'` is load-bearing.** It means: this action refuses
nonsense — an order that does not exist — and does *not* refuse things that are
merely against policy. If your staging system blocks the violation, no agent
can ever commit it, every agent passes, and the benchmark measures nothing.
RigorRun checks this at confirmation time by trying each violation, and drops
rules the environment already enforces with a warning.

## 5. Check it before you trust it

```ts
import { validateAdapter } from '@rigorrun/environment';
expect(await validateAdapter(() => createMyEnvironment(), fixtures)).toEqual([]);
```

This is not optional politeness. A single mis-annotated role silently corrupts
thresholds, boundary mutation and the projection at once, and it does so on
your machine where we cannot see it. The kit checks id stability, link
resolvability, role and unit consistency, that `getState()` returns a copy,
that snapshot and restore round-trip, that execution is deterministic, and that
each action only writes what it says it writes.

## 6. Record the job, and go

```bash
pnpm rigorrun inspect-environment my-system   # what RigorRun can see
pnpm rigorrun compile trace.json -o contract.json
pnpm rigorrun generate contract.json -o benchmark.json
pnpm rigorrun gate benchmark.json --agent reference
```

The trace can come from the browser recorder, from an action log, or from a
hand-written import — they normalise to the same thing.

## What to expect

RigorRun will propose more rules than you want. That is deliberate: it is
cheaper for you to say no to a rule than for it to miss one. Rejected rules are
kept, not deleted, and are used as a control — a defect that breaks a rule you
rejected must *survive* the benchmark, or RigorRun is failing agents for
behaviour you explicitly allowed.

## Where it will disappoint you

- Rules are induced from one recording. Record the job twice on different data
  and the second contract tells you which rules were real.
- A number read off a page is the weakest evidence in the system, and is
  reported as such. If your thresholds live in a policy document rather than in
  UI text, import them instead of hoping.
- The compiler finds nothing about anything your recording never touched.
