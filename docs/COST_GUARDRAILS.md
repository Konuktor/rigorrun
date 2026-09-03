# Cost guardrails

**The constraint: $0. Not "cheap". Not "$5 is basically free". Zero.**

Nothing in the required path of this product can generate a bill. This document
lists every service that could conceivably be involved, its free limit, what
happens when that limit is reached, whether it can bill automatically, and what
stops it.

## The required path costs nothing

| What                                 | Runs on                             | Cost | Needs an account? |
| ------------------------------------ | ----------------------------------- | ---- | ----------------- |
| `pnpm demo`                          | Your machine                        | $0   | No                |
| The CLI, the benchmark, verification | Your machine                        | $0   | No                |
| Dashboard and demo CRM               | Your browser                        | $0   | No                |
| The recorder extension               | Your browser                        | $0   | No                |
| Reports                              | Your filesystem                     | $0   | No                |
| CI gate                              | GitHub free runners, offline agents | $0   | GitHub only       |

Everything below is **optional**.

## Every service, its limit, and our safeguard

| Service                            | Purpose                    | Free limit                                                | At the limit                                                               | Can it bill automatically?                                                          | Our safeguard                                                                                                                                                                                 |
| ---------------------------------- | -------------------------- | --------------------------------------------------------- | -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Cloudflare Workers Free**        | Optional control-plane API | 100k requests/day, 10 ms CPU per invocation               | Requests are rejected with HTTP 429 by Cloudflare until the window resets  | **No.** Workers Free does not overage-bill. Paid requires an explicit plan upgrade. | `wrangler.toml` pins Workers-only + D1. No paid-only binding is configured. Handlers are trivial, well under 10 ms.                                                                           |
| **Cloudflare D1 Free**             | Metadata storage           | 5 GB storage, 5M rows read/day, 100k rows written/day     | Queries fail; the API returns an error and the local product is unaffected | **No.** Free-tier D1 stops rather than bills.                                       | Metadata only, no blobs. Every query is bounded and indexed — the free tier meters _rows read_, so an unindexed scan is the real risk and there are none. Published reports expire (30 days). |
| **Cloudflare R2**                  | —                          | —                                                         | —                                                                          | —                                                                                   | **Not used.** Screenshots and traces stay local by design.                                                                                                                                    |
| **Cloudflare Workers AI**          | Optional model provider    | Free daily allocation                                     | Requests fail; RigorRun degrades to offline                                | No                                                                                  | Used only if an `AI` binding exists. Absent binding is a normal state, not an error.                                                                                                          |
| **Groq**                           | Optional model provider    | Generous free tier, rate limited                          | HTTP 429                                                                   | No — free tier does not auto-upgrade                                                | Quota responses are classified as `kind: 'quota'` and **degrade to offline rather than retry**. Retrying into an overage is a design error, not a resilience feature.                         |
| **Google Gemini**                  | Optional model provider    | Free tier with daily limits                               | HTTP 429                                                                   | Only if _you_ attach billing to the key                                             | Same classification and degradation. RigorRun never attaches billing.                                                                                                                         |
| **Any OpenAI-compatible endpoint** | Optional model provider    | Yours                                                     | Yours                                                                      | Yours                                                                               | Entirely under your control; you supply base URL, key and model.                                                                                                                              |
| **GitHub Actions**                 | CI                         | 2,000 minutes/month on private repos, unlimited on public | Jobs queue or fail                                                         | No                                                                                  | The workflow uses only offline agents and needs no secret. Full run is a couple of minutes.                                                                                                   |
| **npm registry**                   | Dependencies               | Free                                                      | —                                                                          | No                                                                                  | —                                                                                                                                                                                             |
| **Playwright browsers**            | E2E                        | Free                                                      | —                                                                          | No                                                                                  | Falls back to a system Chromium when present, so a clean machine need not download one.                                                                                                       |

## What is deliberately absent

- **No Stripe, no billing code, no payment surface.**
- **No credit card is required at any point.**
- **No service is provisioned that meters and bills by default.**
- **No GPU.** Nothing in the architecture wants one. Any experimental compute
  discussed elsewhere is a free notebook service and is not part of production.
- **No paid observability SaaS.** Logs are local and structured.
- **No Kubernetes, no Redis, no Docker requirement.**

## Graceful degradation, concretely

Quota exhaustion must never escalate into spend. Provider failures are
classified, and `quota` is treated as _stop_, not _retry_:

```ts
if (status === 429 || /quota|rate.?limit|exhausted/i.test(body)) {
  return new ProviderError('Provider quota reached. Falling back to offline mode
                            rather than retrying.', 'quota', status);
}
```

Every caller handles this by falling back to the deterministic path. The
LLM-assisted generator, for example, returns the deterministic benchmark
unchanged and says so in its note. The product keeps working; it just stops
using the model.

`resolveProvider()` returning `null` — the state on a machine with no keys, which
is the machine the demo is designed for — is a completely normal outcome that
every caller handles.

## If you decide to upgrade later

Clearly out of scope for the MVP, listed only so the boundary is unambiguous:

- **Cloudflare R2** for large artefacts if you ever want traces in the cloud
  (a privacy decision before it is a cost one).
- **Workers Paid** ($5/month) for higher limits and longer CPU time.
- **A hosted Postgres** if the metadata model outgrows D1.
- **A managed queue** for scheduling large benchmark runs.

None of these are required. None are referenced by the shipped configuration.

## Verifying the claim yourself

```bash
pnpm install && pnpm demo          # no account, no key, no network
pnpm test                          # no network
pnpm rigorrun doctor               # shows every provider as "not set" by default
```

The end-to-end suite asserts that a full demo run issues **zero** requests
outside the local origin. If that ever stops being true, CI fails.
