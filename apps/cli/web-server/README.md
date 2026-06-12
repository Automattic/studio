# Studio Web server

The CLI `web-server` command is the HTTP + SSE backend for running Studio's
agent from a browser (the "Studio Web" exploration). It exposes the same
capabilities the desktop app reaches over IPC, but over HTTP, so the portable
`apps/ui` renderer can talk to it through the **web connector**
(`apps/ui/src/data/core/connectors/web`).

```
npm run build:web --workspace=apps/ui        # once, or after UI changes
node apps/cli/dist/cli/main.mjs web-server   # listens on 127.0.0.1:8088 (--port / STUDIO_WEB_SERVER_PORT)
```

The server serves the built UI itself — open http://localhost:8088 and that's
the whole setup. The API is namespaced under `/api` so the SPA's real-path
routes (`/sessions/:id`, `/sites/:id`) can share the origin.

For UI development with hot reload, run the Vite dev server instead (it targets
the backend's default port cross-origin):

```
cd apps/ui && npm run dev:web                # serves the browser entry on :5300
```

## Process topology

Everything here runs on one machine, but the pieces map cleanly onto a hosted
deployment. Three distinctions matter before counting:

- A **server** is a long-lived listener.
- The **agent** is a short-lived child process forked _per message_ — not a server.

### Local

| Piece | Lifetime | Role |
|-------|----------|------|
| Web UI dev server (Vite) | long-lived | serves the SPA to the browser |
| `web-server` (Express) | long-lived | HTTP + SSE API: sessions, sites, agent runs |
| agent (`code sessions resume … --json`) | per message | forked child, same subcommand the desktop app forks |

The server binds to loopback only: it exposes the local user's sessions and
WordPress.com data without authentication, so it must not be reachable from the
network.

### Hosted (direction, not in this increment)

| Piece | Lifetime | Notes |
|-------|----------|-------|
| Web UI | static | served from a CDN / static host |
| `web-server` API | long-lived **fleet** | one multi-tenant backend |
| session sandbox | **ephemeral, one per session** | the agent runs here; spun up and down per session |

Going from local to hosted, only `web-server` becomes a fleet; the per-session
sandbox replaces "your laptop" as the place the agent runs rather than adding a
new always-on server.

## Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `GET`  | `/api/health` | liveness check |
| `GET`  | `/api/events` | SSE stream carrying every run's `AgentRunEvent`s |
| `GET`  | `/api/sites` | the user's workable WordPress.com sites (requires `studio auth login`) |
| `GET/POST` | `/api/sessions` | list / create AI sessions (shared session store) |
| `GET/PATCH/DELETE` | `/api/sessions/:id` | load / star-archive / delete a session |
| `POST` | `/api/sessions/:id/messages` | send a prompt — forks the agent, returns `{ runId }` |
| `POST` | `/api/sessions/:id/model` | persist a model override for the session |
| `GET`  | `/api/runs/active` | active agent runs |
| `POST` | `/api/runs/:runId/interrupt` | graceful interrupt, SIGKILL on second attempt |
| `POST` | `/api/runs/:runId/answer` | answer an agent question |
