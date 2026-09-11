# Security policy

## Supported versions

RigorRun is Early Access. Only the latest published version on npm is supported; there are no
backports.

```bash
npm view rigorrun version
```

## Reporting a vulnerability

Please report privately, through
[GitHub's private advisory form](https://github.com/Konuktor/rigorrun/security/advisories/new).

Include what you did, what happened, and the output of `rigorrun --version`. You will get a reply
within 72 hours.

Please do not open a public issue for anything that could be used against somebody else's machine
before it is fixed.

There is no bounty. Advertising one with no revenue behind it would be dishonest. You will be
credited in the changelog if you would like to be.

## Scope

RigorRun runs on the user's machine and connects to systems they configure, using credentials they
supply. In scope:

- Anything that lets a web page other than the local interface reach the runner's API.
- Anything that causes a credential to be written outside the OS credential store, printed, or
  included in an export or a feedback bundle.
- Anything that causes `rigorrun verify` to execute untrusted code outside its container.
- Anything that lets an imported project run a command without the explicit approval step.

## Known limits, which are not vulnerabilities

These are documented at [rigorrun.xyz/security](https://rigorrun.xyz/security) and carried on every
verification record RigorRun writes:

- **The container runtime daemon runs as root.** RigorRun reduces blast radius but does not claim to
  prevent a container escape; an escape reaches the host.
- **A state reading that came only from the server's own tools is corroboration, not proof.**
- **Verification records are hashed, not signed.** They defend against accidental change, not
  against a determined author.
- **A verdict against a real system is `PARTIAL`.** It reflects the reads the operator nominated and
  nothing beyond them.
