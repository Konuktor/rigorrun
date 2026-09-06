# Releasing

`rigorrun` is published to npm on the `latest` channel, so the install command
is `npx rigorrun`. **Early Access** describes how finished the product is;
`latest` describes which channel npm installs from. They are different claims
and they are allowed to disagree.

## The gates, in order

```bash
pnpm release:verify    # contrast, lint, domain, typecheck, unit, build,
                       # e2e, e2e:external, e2e:restart, a11y, visual, cross, proof
pnpm verify:package    # build, pack, allowlist, secret scan, clean install,
                       # run, old-Node message, audit, licences, SBOM, and the
                       # whole fresh-user journey against the packaged artifact
```

`verify:package` publishes nothing. Its last line says whether publishing would
be safe and prints the exact command. It also checks the channel matches the
version: a prerelease may not land on `latest`, and a release must.

## Publishing by hand

The first release was manual, because the account was authenticated
interactively. npm requires two-factor authentication for a write, and this
account uses a security key, so npm prints a URL and waits:

```
Authenticate your account at:
https://www.npmjs.com/auth/cli/<id>
Press ENTER to open in the browser...
```

Open it, approve with the key, and npm continues. The request expires after
about five minutes; if it lapses, run the publish again for a fresh one.

Never create a granular token with "bypass 2FA" to avoid this. It is a
long-lived credential that can publish without a human, which is the thing 2FA
exists to prevent.

## Publishing from CI, without a token

`.github/workflows/release.yml` is written for npm's **trusted publishing**:
GitHub mints a short-lived OIDC token for that workflow in that repository, and
npm accepts it because the package is configured to trust exactly that. Nothing
long-lived is stored in repository secrets, and every published tarball carries
a provenance attestation naming the commit and workflow that produced it.

The workflow is tag-triggered (`v*`), refuses to run if the tag and the manifest
version disagree, and runs `pnpm verify:package` before it publishes anything.

### The one account-side step — done

The trusted publisher is an account action, done once after the package existed.
It is **configured** for `rigorrun`:

| | |
| --- | --- |
| Provider | GitHub Actions |
| Organization or user | `Konuktor` |
| Repository | `rigorrun` |
| Workflow filename | `release.yml` |
| Environment | `npm` |
| Permissions | publish, stage publish |

It was set from the CLI (npm ≥ 12), which is the fastest way and needs the
account's second factor:

```bash
npm trust github rigorrun --repo Konuktor/rigorrun --file release.yml \
  --env npm --allow-publish -y
npm trust list rigorrun          # confirm the relationship
```

The web path is equivalent: **npmjs.com/package/rigorrun → Settings → Trusted
publisher → GitHub Actions**, with the same values.

There is no npm write token anywhere — not in repository secrets, not in the
`npm` environment (which holds zero secrets), nowhere. Publishing has no
credential to fall back on but the short-lived OIDC token GitHub mints for this
workflow, which is the intended design: a stolen repository secret cannot
publish because there is none.

### Then, for the next release

```bash
# bump packages/cli/package.json and packages/cli/src/help.ts together (to vX.Y.Z)
pnpm release:verify && pnpm verify:package
git commit -am "…" && git push
git tag -a vX.Y.Z -m "…" && git push origin vX.Y.Z
```

The tag starts the workflow. Watch it rather than assuming: npm versions are
immutable, so a bad release is fixed by publishing the next patch, never by
overwriting one.

## After publishing

Do not treat npm's success message as proof. Ask the registry:

```bash
npm view rigorrun version
npm view rigorrun dist-tags
npm view rigorrun dist.integrity
```

Then install what a stranger installs — a clean `HOME`, a clean npm cache, a
directory that is not this repository — and walk the whole journey against it:

```bash
npx --yes rigorrun --version
```
