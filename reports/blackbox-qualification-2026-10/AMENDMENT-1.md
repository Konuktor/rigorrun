# Amendment 1: development runs and when the counted run happens

Written 2026-10-01T02:15Z. No agent, harness or run of this qualification existed yet.

The pre-registration does not say whether runs before the freeze are allowed. The Stripe
pre-registration does say so. To match it:

- **Development runs.** Before `freeze.json` exists, the harness and the agents may be run to fix
  faults in the harness itself. These runs:
  - never count;
  - are listed in `dev-log.md`;
  - must not change the jobs, the agents' behaviours, the expected verdicts, or the gates.
- **Counted run.** It runs once, at the `release/0.4.0` commit that is about to be tagged `v0.4.0`.
  That way the qualified product is the one released. "A later product commit invalidates the run"
  means a product commit made between the freeze and the end of the counted run.
