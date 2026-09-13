# DRAFT — not submitted.

**Title:** With the documented `WORKTIDE_API_URL=…/v1`, every IRI-based tool requests `/v1/v1/…` (404); create-type tools return 500 against the current backend

Thanks for the MCP — the tool surface is exactly the kind of thing an agent needs. Against a local Worktide backend (commit `0739317`, docker compose, fixtures loaded, personal access token, `WORKTIDE_WORKSPACE_ID` set) at `worktide-mcp` commit `4dbd085`, two problems make most state-changing tools unusable.

## 1. Doubled `/v1` prefix on every IRI-based call

`client.ts` sets the axios `baseURL` to `WORKTIDE_API_URL`, which the README documents as `https://api.worktide.example.com/v1`. `resolveTaskIri` / `resolveProjectIri` return the API's own IRIs, which already begin with `/v1/`, and the tools then call `client.get(iri)` / `mergePatch(client, iri, …)` / `client.patch(iri, …)`:

```
tasks.get     {"task":"AUD-1"}            → [404] No route found for "GET   http://127.0.0.1:18081/v1/v1/tasks/<uuid>"
tasks.update  {"task":"AUD-3","priority":"urgent"} → [404] … "PATCH …/v1/v1/tasks/<uuid>"
tasks.complete{"task":"AUD-1"}            → [404] … "PATCH …/v1/v1/tasks/<uuid>"
projects.get  {"project":"AUD"}           → [404] … "GET   …/v1/v1/projects/<uuid>"
projects.archive {"project":"AUD"}        → [404] … "PATCH …/v1/v1/projects/<uuid>"
```

Reproduced 3/3 each; the oracle (REST + MySQL) confirms nothing changed. `tasks.search`, `projects.list`, `projects.board`, `time.*` and `me.*` use relative paths and work.

**Fix:** strip the base path from IRIs before calling (e.g. `iri.replace(/^\/v1/, '')`), or set `baseURL` to the origin and prefix `/v1` in every relative path. A unit test that builds the client with a `/v1` base and asserts the request URL for `tasks.get` would pin it.

## 2. Create-type tools 500: the payload carries no `workspace` / `user`

```
tasks.create        → [500] Typed property App\Entity\Task::$workspace must not be accessed before initialization
tasks.addDependency → [500] Typed property App\Entity\TaskDependency::$workspace must not be accessed before initialization
projects.create     → [500] Typed property App\Entity\Project::$workspace must not be accessed before initialization
time.log            → [500] Typed property App\Entity\TimeEntry::$user must not be accessed before initialization
```

Reproduced 3/3 each. The same `POST /v1/projects` and `POST /v1/tasks` succeed (201) when the body includes `"workspace": "/v1/workspaces/<id>"`. Sending the `X-Workspace-Id` header alone does not populate it for a PAT-authenticated request. The MCP commit predates the backend commit by three weeks, so this may be API drift rather than an original defect — either way the pair does not work today.

**Fix:** include `workspace` (from `WORKTIDE_WORKSPACE_ID` or `me.whoami`) in the create payloads, and `user` (from `/auth/me`) in `time.log`. On the backend side, a validation error (422) for the missing relation would be kinder than a 500.

## Also noticed

- `package.json` has `"test:tools": "tsx src/dev-runner.ts"` but `src/dev-runner.ts` is not in the repository; there is no test suite.
- `tasks.complete` filters `/task_statuses?isCompleted=true`, but the API's field is `completed`; once the 404 is fixed it will probably pick the first status returned rather than a completed one (untested here because of the 404).
- The repository has no LICENSE file.

Full traces (before/after oracle snapshots, tool results) are available on request.
