# Testing an agent that works by clicking

Some systems have no API worth the name. RigorRun can drive a browser, so an
agent that works by clicking can be watched doing it.

Read the next section before you decide this is what you want.

## The DOM is not authoritative state

A page saying **"Refund issued"** is a claim by the same system that would have
to be wrong for the refund not to exist. Reading that back and calling it
verification is exactly the mistake RigorRun exists to stop people making about
an agent's own report — and it does not become acceptable because the claim is
rendered in a div rather than said in a sentence.

So a browser connection **cannot verify anything on its own**. Every verdict
from one says `OBSERVATIONAL`: RigorRun watched what your agent did, and did not
check what changed. That is a real result and a much weaker claim than a run
against records, and it is labelled that way on every case.

RigorRun will not let a browser verify itself even if you ask. The `verifier`
field on a browser connector cannot hold another browser — the type forbids it —
so this is a fact about the code rather than a paragraph in a document.

## Attaching something that can be read

Give the browser connector an MCP or OpenAPI connection to the same system, and
you get the arrangement worth having: **the clicking is watched in the page, and
the verdict comes from records.** Verification becomes `PARTIAL`, exactly as it
would be for that connector on its own.

Most systems that look API-less have something. An admin endpoint, a read-only
report, a database view behind a tiny MCP server. It does not have to be able to
*do* the job — it only has to be able to say what happened.

## What an agent can do

`navigate`, `click`, `fill`, `select`, `press`, `read_page`, `screenshot`.

Things are found by **role and name, label, test id, or text** — never by an
expression. `page.evaluate` is not exposed to anything, by anyone, which is what
keeps "RigorRun never evaluates code from data" true in a package whose whole
job is driving a JavaScript engine. A bare string is treated as text to look
for, because that is what people type.

`read_page` returns the accessibility tree rather than the markup: the closest
thing a page has to describing itself in words a person would use, and stable
against the styling changes that break every selector written against class
names. It goes into the evidence so you can see what your agent was looking at.
Nothing is verified against it.

Screenshots are written to files under the project and referenced by path. A run
artefact with base64 images in it is how a 200MB run artefact happens.

## It stays where you point it

Every navigation is checked against the origin you gave. A page can link
anywhere, and an agent following one off-site would be RigorRun driving a
browser to an address you never named.

## Installing it

RigorRun does not install Playwright for you. It is about 300MB once its
browsers are there, most projects never need a browser at all, and a tool people
try with `npx` in ten minutes cannot open with that download.

```bash
npm i -g playwright-core
npx playwright install chromium
```

Then connect. If it is missing, RigorRun says exactly this rather than producing
a module-not-found — and nothing about your project changes either way.

## What is not built yet

- **No recorder.** You drive the browser through RigorRun's own screen, one
  action at a time, as with any other connector. Recording a person using their
  own browser is a different and harder problem.
- **No file upload.**
- **No stored login.** Each session starts fresh, so a job that needs signing in
  has to sign in as part of the job.
