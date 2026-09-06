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

### The one manual step, on npm's side

This cannot be done from a repository — it is an account action, and it has to
happen once, after the package exists:

1. Sign in at <https://www.npmjs.com> as the package owner.
2. Go to the package: **npmjs.com/package/rigorrun** → **Settings**.
3. Under **Trusted publisher**, choose **GitHub Actions** and fill in:
   - Organization or user: `Konuktor`
   - Repository: `rigorrun`
   - Workflow filename: `release.yml`
   - Environment: `npm`
4. Save.

Until that is saved, the workflow will fail at the publish step with a 404 or a
401 from the registry — it has no other credential to fall back on, which is
the intended design.

### Then, for the next release

```bash
# bump packages/cli/package.json and packages/cli/src/help.ts together
pnpm release:verify && pnpm verify:package
git commit -am "…" && git push
git tag -a v0.1.1 -m "…" && git push origin v0.1.1
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
