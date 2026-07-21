# Studio Web (hosted)

`apps/hosted` is the experimental **Studio Web** backend: an HTTP + SSE server
that drives Studio's agent from a browser. It exposes the same capabilities the
desktop app reaches over IPC, but over HTTP, so the portable `apps/ui` renderer
can talk to it through the **web connector**
(`apps/ui/src/data/core/connectors/hosted`).

Unlike the desktop app and CLI, this targets a hosted deployment — WordPress.com
/ Telex APIs and a server-side agent sandbox — not a local WordPress install. It
deliberately depends on nothing in `apps/cli`.

```
npm run build:hosted --workspace=apps/ui   # once, or after UI changes
npm run build --workspace=apps/hosted   # build the server bundle
npm run start --workspace=apps/hosted    # listens on 127.0.0.1:8088 (STUDIO_WEB_SERVER_PORT)
```

`npm run dev --workspace=apps/hosted` does the build + start in one step.

The server serves the built UI itself — open http://localhost:8088 and that's
the whole setup. The API is namespaced under `/api` so the SPA's real-path
routes (`/sessions/:id`, `/sites/:id`) can share the origin.

For UI development with hot reload, run the Vite dev server instead (it targets
the backend's default port cross-origin):

```
cd apps/ui && npm run dev:web   # serves the browser entry on :5300
```

## Status: agent runtime is stubbed

The session, site, and SSE endpoints are live, but **starting an agent run is not
implemented yet**. Where the agent runs sits behind the `AgentRuntime` seam
(`src/runtime.ts`); the default is `stubRuntime`, which throws. The hosted
backend will inject a runtime that runs the agent inside a per-session SecEx
sandbox via `setAgentRuntime`, without touching the run orchestration in
`src/agent-runs.ts`.

(The previous iteration forked the `studio code` CLI as a local child process.
That coupled the server to a local Studio install and was removed when this moved
out of `apps/cli`.)

## Process topology

Three distinctions matter:

- A **server** is a long-lived listener.
- The **agent** runs per message — short-lived, not a server.

### Hosted (target)

| Piece | Lifetime | Notes |
|-------|----------|-------|
| Web UI | static | served from a CDN / static host |
| hosted API | long-lived **fleet** | one multi-tenant backend |
| session sandbox | **ephemeral, one per session** | the agent runs here; spun up and down per session |

### Local development

For now everything runs on one machine. The server binds to loopback only: it
exposes the local user's sessions and WordPress.com data without authentication,
so it must not be reachable from the network. Sessions are read from the local
Studio appdata directory (a temporary stand-in — see `src/lib/paths.ts`).

## Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `GET`  | `/api/health` | liveness check |
| `GET`  | `/api/events` | SSE stream carrying every run's `AgentRunEvent`s |
| `GET`  | `/api/sites` | the user's workable WordPress.com sites (requires `studio auth login`) |
| `GET/POST` | `/api/sessions` | list / create AI sessions (shared session store) |
| `GET/PATCH/DELETE` | `/api/sessions/:id` | load / star-archive / delete a session |
| `POST` | `/api/sessions/:id/messages` | send a prompt — starts an agent run, returns `{ runId }` (stubbed) |
| `POST` | `/api/sessions/:id/model` | persist a model override for the session |
| `GET`  | `/api/runs/active` | active agent runs |
| `POST` | `/api/runs/:runId/interrupt` | graceful interrupt, SIGKILL on second attempt |
| `POST` | `/api/runs/:runId/answer` | answer an agent question |
