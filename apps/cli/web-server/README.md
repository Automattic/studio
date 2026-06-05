# Studio Web server (proof of concept)

The CLI `web-server` command is the HTTP + SSE backend for running Studio's agent
from a browser (the "Studio Web" exploration). It exposes the same capabilities
the desktop app reaches over IPC, but over HTTP, so the portable `apps/ui`
renderer can talk to it through the **web connector**
(`apps/ui/src/data/core/connectors/web`).

```
node apps/cli/dist/cli/main.mjs web-server   # listens on :8088 (STUDIO_WEB_SERVER_PORT)
```

## Process topology

Everything here runs on one machine, but the pieces map cleanly onto a hosted
deployment. Three distinctions matter before counting:

- A **server** is a long-lived listener.
- The **agent** is a short-lived child process forked _per message_ — not a server.
- A **workspace** is a git-backed directory — not a server.

### Local (this PoC)

| Piece | Lifetime | Role |
|-------|----------|------|
| Web UI dev server (Vite) | long-lived | serves the SPA to the browser |
| `web-server` (Express) | long-lived | HTTP + SSE API: sessions, sites, agent runs, publish |
| agent (`code sessions resume … --json`) | per message | forked child; edits the session's workspace |
| session workspace (`~/Studio/studio-web-<id>`) | persistent | git-backed working dir (not a server) |

So: **two** long-lived servers, plus one short-lived agent process per message,
plus one workspace directory per session — all on the same machine.

### Hosted

| Piece | Lifetime | Notes |
|-------|----------|-------|
| Web UI | static | served from a CDN / static host |
| `web-server` API | long-lived **fleet** | one multi-tenant backend |
| session sandbox | **ephemeral, one per session** | the agent and workspace move here; spun up and down per session, not kept warm |
| project repo (git) | durable | the real "layer": survives the sandbox, re-cloned on resume, pushed on publish |

The key idea: the **durable layer is the git project repo**, hosted on
infrastructure — not any single server and not the sandbox. The per-session
sandbox is throwaway compute: it's _where_ the agent runs and where the workspace
is checked out, but losing it never loses the project, because git is the source
of truth. Going from local to hosted, only `web-server` becomes a fleet; the
sandbox **replaces "your laptop"** as the place the agent runs rather than adding
a new always-on server.

## Workspace model (draft → publish)

Each session gets its own git-backed workspace — the cloud analog of Studio App's
local site (`workspaces.ts`):

- **Draft** = the working tree. `git status` is the change set.
- **Publish** = a commit, plus (when a deploy remote is configured) a `git push`
  to the project's deploy target, which lands changes on the live site.

Relevant endpoints:

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/sessions` | create a session and bind it to a fresh git-backed workspace |
| `GET`  | `/sessions/:id/changes` | the session's draft change set (`git status`) |
| `POST` | `/sessions/:id/publish` | snapshot the workspace as a commit (and push if a deploy remote exists) |

In this PoC there is no deploy remote, so `publish` records the reviewable commit
and reports `pushed: false`. Wiring the deploy remote (so `publish` deploys to a
hosted WordPress site) is a later, hosted-only increment.
