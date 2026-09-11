# Repository architecture

Written before anything moved, because the decision this records is the kind that cannot be undone
by reverting a commit.

## The constraint

`rigorrun@0.2.0` is on npm with a SLSA v1 build provenance attestation, published by GitHub Actions
using npm trusted publishing:

```console
$ npm view rigorrun --json | jq '{_npmUser, dist: {attestations: .dist.attestations}}'
{
  "_npmUser": { "name": "GitHub Actions", "email": "npm-oidc-no-reply@github.com" },
  "dist": {
    "attestations": {
      "url": "https://registry.npmjs.org/-/npm/v1/attestations/rigorrun@0.2.0",
      "provenance": { "predicateType": "https://slsa.dev/provenance/v1" }
    }
  }
}
```

The workflow holds no npm token — `.github/workflows/release.yml` requests `id-token: write` and npm
trusts the OIDC identity of the workflow. Nothing long-lived exists to be stolen from repository
secrets.

**npm trusted publishing requires a public source repository, and the attestation names this
repository and the commit it was built from.** So:

- Making `Konuktor/rigorrun` private breaks trusted publishing for every future release. Publishing
  would fall back to a long-lived token, which is strictly weaker than the arrangement it replaced.
- It also turns the existing 0.2.0 attestation into a pointer at a repository nobody can open. The
  attestation stays cryptographically valid and becomes practically useless: a person can verify
  that *some* workflow in *some* repository built the tarball, and cannot read the source to see
  what that workflow built.

Provenance that cannot be followed is theatre. Protecting it outranks a preference about where
development happens.

## What was considered

**Option A — keep the source public, move internal material out.** Development stays here.
Everything that should not be public moves to a private repository. Provenance keeps working with no
change to the release workflow.

**Option B — private monorepo, public release repository.** Development moves to a private
repository; a public one holds the source that gets published and runs the release workflow. But the
workflow has to build from the source it publishes, so *that source is public either way*. The
source is no more private than under Option A, and there are now two repositories to keep in step
and a sync step that can silently drift. It buys nothing and costs a class of bug.

**Option C — go private, accept the loss.** Rejected. It trades a real supply-chain property that
users can check for an appearance of professionalism that nobody can.

## What was done — Option A

| Repository | Visibility | Holds |
| --- | --- | --- |
| `Konuktor/rigorrun` | **public** | Source, the release workflow, the public site, the interface. |
| `Konuktor/rigorrun-internal` | **private** | Audits, gate records, accelerator material, outreach, competitive analysis, infrastructure notes. |
| `Konuktor/rigorrun-docs` | — | **Not created.** See below. |

**No repository visibility was changed.** `Konuktor/rigorrun` was already public and stays public,
so nothing can detach a fork or lose a star. The private repository is new and starts empty of
public history.

### What moved out

Everything that is a business artifact rather than a product artifact:

- `docs/CLOUDFLARE_READINESS.md` — the account subdomain, a D1 database UUID, teardown commands, and
  the names of two unrelated commercial projects on the same Cloudflare account. The
  highest-sensitivity file that was in the repository.
- `docs/GATE0_OUTREACH.md` — named prospects and verbatim unsent cold-email drafts.
- `docs/ALTALAB*.md`, `docs/DIFFERENTIATION_DEMO.md`, `docs/DEMO.md` — accelerator submission
  material, go-to-market, moat and ICP.
- `docs/COMPETITIVE_ADVANTAGE.md`, `docs/PRODUCT_DECISIONS.md`, `docs/TTFRV_PROTOCOL.md`,
  `docs/THIRD_PARTY_DOGFOOD.md` — positioning and internal measurement discipline.
- `docs/*AUDIT*.md` except `V1_GAP_AUDIT.md` — adversarial audits of shipped releases.
- `STATUS_V2.md`, `STATUS_ADVANTAGE.md` — branch- and date-scoped internal status.

### Why there is no separate docs repository

The plan called for one, and the reason for it evaporated when the source repository stayed public.

A separate `rigorrun-docs` was going to exist so that documentation could remain public while
development went private. Development is not going private, so the documentation is already in a
public repository with a public issue tracker and a working "edit this page" link.

What a separate repository would cost is concrete: `apps/docs` imports `@rigorrun/design` for its
tokens and typefaces, and every `@rigorrun/*` package is private and unpublished. A standalone docs
repository would therefore need its own copy of the palette and the type scale — a second source of
truth for the exact thing the brand book exists to prevent, kept in step by hand, in a project whose
first rule is that no user-visible value is a literal.

The benefits were a smaller clone and a separate issue tracker. Neither is worth a colour that
drifts. If the docs ever outgrow this — several writers, a translation, a release cadence of their
own — the move is a `git subtree split` and this decision gets revisited with a real reason.

### What deliberately stayed public

- **`docs/V1_GAP_AUDIT.md`.** It is an audit in genre, and it is the thing the npm README points at
  as what to read before relying on this. Moving it would break the one link on the package page
  that exists to tell somebody what does not work.
- **`docs/SECURITY.md`, `docs/SECURITY_MODEL.md`, `docs/PRIVACY.md`.** Written as public
  commitments. A threat model that is secret is a threat model nobody can hold you to.
- **Every reference document.** Architecture, protocols, environments, testing, CI, releasing.

## Consequences worth knowing

- **The private repository is not a mirror.** It holds documents, not code. There is no sync step
  and nothing to drift.
- **Cloudflare Pages is unaffected.** Deployment is a direct `wrangler pages deploy` of a built
  directory, not a Git integration, so no repository change can break a deploy.
- **The GitHub repository metadata was wrong and was corrected.** The description was the 0.1-era
  positioning, and `homepageUrl` pointed at `rigorrun.pages.dev` — contradicting the canonical tag
  on every page and the note in `robots.txt`. There was also no root `LICENSE`, so GitHub reported
  `license: null` on an MIT package.

## If this is revisited

The question to ask is not "can the repository be private" — it can, at any time. It is **"what does
a person who has just run `npx rigorrun` do next if they want to check what they installed?"** Today
the answer is: verify the attestation, follow it to a commit, and read the code that produced the
tarball. Any architecture that leaves that question without an answer is worse than this one,
whatever it looks like from outside.
