# The released tree and the qualified tree

Qualified: `27d40a891a9be18b72f2a562c2193d653e53547b` (`freeze-T.json`, `freeze-L.json`). Released as
0.5.0: the same tree with its version strings changed from 0.4.0 to 0.5.0 — nothing else under
`packages/`. The whole difference, as `git diff 27d40a8 <release tree>`:

```diff
diff --git a/packages/cli/package.json b/packages/cli/package.json
index 5d7d570..424e6b3 100644
--- a/packages/cli/package.json
+++ b/packages/cli/package.json
@@ -1,6 +1,6 @@
 {
   "name": "rigorrun",
-  "version": "0.4.0",
+  "version": "0.5.0",
   "description": "Permission and scope tests for AI agents: send your agent tickets that tempt it to act for the wrong customer, then read the real system (Stripe first) instead of the transcript.",
   "keywords": [
     "mcp",
diff --git a/packages/cli/src/help.ts b/packages/cli/src/help.ts
index d37e267..db45b44 100644
--- a/packages/cli/src/help.ts
+++ b/packages/cli/src/help.ts
@@ -5,7 +5,7 @@
  * artefact, so a stale value here is a support conversation about the wrong
  * release.
  */
-export const VERSION = '0.4.0';
+export const VERSION = '0.5.0';

 /**
  * The bundled recordings `rigorrun demo` replays, named here with the rest of
diff --git a/packages/core/src/index.ts b/packages/core/src/index.ts
index 1161b87..ba1378c 100644
--- a/packages/core/src/index.ts
+++ b/packages/core/src/index.ts
@@ -28,4 +28,4 @@ export * from './record.ts';
  * record recorded a harness that was never released. Kept in step with
  * package.json by `packages/cli/test/package.test.ts`.
  */
-export const RIGORRUN_VERSION = '0.4.0';
+export const RIGORRUN_VERSION = '0.5.0';
```

Check it yourself: `git diff 27d40a891a9be18b72f2a562c2193d653e53547b v0.5.0:packages`.
