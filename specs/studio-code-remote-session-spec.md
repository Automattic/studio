# Spec: `studio code` Remote Session (Telegram bridge)

> **Status note (2026-04-28):** the `/remote-session` slash command and its subcommands (`attach|detach|new|status`) are **deferred** for the initial PoC. Only the `studio code --remote-session` flag is shipping. The slash-command sections below describe the planned design and can be re-introduced once a non-blocking REPL mode lands.
>
> **Status note (2026-04-30, STU-1649):** background-daemon support is implemented under a new `studio code remote-session` subcommand tree (`start [--detach]`, `stop`, `status`). The original `studio code --remote-session` flag still works and is equivalent to `studio code remote-session start` in foreground mode. Daemonized runs are tracked via `~/.studio/remote-session.pid`. The whole surface remains gated by the `STUDIO_ENABLE_REMOTE_SESSION=true` feature flag.
>
> **Status note (2026-05-01, STU-1655):** the `/remote-session` REPL slash command is back, redesigned around the daemon. `/remote-session start` spawns the detached daemon (same code path as `studio code remote-session start --detach`) and returns immediately. `/remote-session stop` terminates the daemon. The REPL never blocks. While a daemon is alive, the statusline shows a green `Remote session active` indicator. The `attach`/`detach`/`new` subcommands and the previous "blocking attach" mode remain off the table.
>
> **Status note (2026-05-05, STU-1681):** `studio code remote-session start` is now detached by default; pass `--no-detach` to keep it running in the foreground (the previous default). A new `studio code remote-session attach` subcommand connects a terminal to a running daemon, replays a tail of `~/.studio/remote-session.log`, and streams new entries live; Ctrl-C / SIGTERM detaches the terminal without stopping the daemon. The `attach`/`detach` wording is now the canonical "connect / disconnect" surface — both for the subcommand and for the in-REPL slash command.
>
> **Status note (2026-05-06, STU-1682):** the `studio code --remote-session` autostart flag has been removed. It was redundant with `studio code remote-session start` and the in-REPL `/remote-session` slash command, and kept the CLI surface confusing. Use the subcommand tree as the single entry point. The `--remote-chat-id` and `--remote-bot` flags are now only available on `studio code remote-session start` (where they always lived); `--message-from-stdin` remains as a hidden headless turn entry point used by the daemon's turn runner.
>
> **Status note (2026-05-15, STU-1729):** the `STUDIO_ENABLE_REMOTE_SESSION` feature flag has been removed. The `studio code remote-session` subcommand tree, the `/remote-session` slash command, the `--message-from-stdin` headless entry point, and the bottom-bar daemon status poll are all enabled unconditionally. Public availability still requires the WordPress.com backend gating to be lifted in parallel.

## Overview

Add a "remote session" capability to the `studio code` CLI that lets the user drive `studio code` from Telegram. Each Telegram message arriving at the WordPress.com server is delivered to `studio code` as a new turn, and each assistant reply is posted back to Telegram.

The server side already exists. This spec covers only the local CLI changes.

## Goals

- A Telegram chat shares one resumable `studio code` session, keyed by `chat_id`. Each polled message resumes the session for its `chat_id`, runs one turn, and exits.
- Messages share history within a chat (via `--resume-session`), and can be reset on demand.
- The server's bearer token is the auth boundary. The local agent trusts that any message returned by `/local-agent-poll` is authorized for the holder of the token, and derives the reply target (`chat_id`, `bot`) from the polled message itself. No pre-binding to a specific chat is required.
- Optional pinning: a user can still set `chat_id` (and/or `bot`) in config to filter inbound messages and pin the outgoing reply identity, e.g. for a kiosk or shared workstation.
- Two entry points to the same feature:
  - **Subcommand**: `studio code remote-session start` runs the daemon (detached by default; `--no-detach` keeps it in the foreground). `studio code remote-session attach` connects a terminal to a running daemon's log stream.
  - **Slash command**: `/remote-session attach|detach` connects (and disconnects) the REPL from the running daemon's log stream. Spawning and stopping the daemon are the subcommand's job.
- Fully autonomous: tool calls and file modifications proceed without per-message approval (the underlying agent already supports `--auto-approve`).
- Outbound-only network from the laptop (poll + post). No inbound ports, no tunnel, no PTY plumbing.

## Non-goals (v1)

- Multi-chat binding. v1 binds one chat per laptop, configured once.
- Per-message approval flow from Telegram.
- Forwarding intermediate progress events (`progress`, `info`, streamed assistant chunks, tool_use events) to Telegram. Only the final `result` text (or, for a paused turn, the flattened `question.asked`) is posted.
- Running the poll loop **inside** the REPL process. The daemon design (STU-1649, STU-1681) keeps polling out-of-process so the REPL stays interactive while a session is attached.

## Server contract (already deployed)

Base URL: `https://public-api.wordpress.com/wpcom/v2/telegram-bot`

### `GET /local-agent-poll`

Headers: `Authorization: Bearer <token>`

Returns any pending messages for the local agent. Confirmed response shape:

```json
{
  "messages": [
    {
      "message": "what's the weather?",
      "chat_id": 236756880,
      "bot": "my_test_bot",
      "user_id": 51814349,
      "timestamp": 1776848744
    }
  ]
}
```

Notes:
- The user's text is in `message`, not `text`.
- `messages` is always an array. An empty array (or `{}`, or an empty body) means nothing is queued; the worker MUST handle this by sleeping and retrying.
- The controller drains the array in order, running one `studio code --json` turn per entry before polling again.

### `POST /local-agent-respond`

Headers: `Authorization: Bearer <token>`, `Content-Type: application/json`

Body:
```json
{
  "chat_id": 236756880,
  "text": "Hello from local agent!",
  "bot": "my_test_bot"
}
```

Used for assistant replies and status messages.

## Reference: `studio code --json` event stream

A single invocation of `studio code --json "<prompt>"` emits an NDJSON stream on stdout and exits. Each line is a JSON object with a `type` field and an ISO `timestamp`.

Events actually emitted (source: `apps/cli/ai/output-adapter.ts`, `apps/cli/ai/json-events.ts`):

| Event type | Shape | Meaning |
|---|---|---|
| `turn.started` | `{ type, timestamp }` | Turn has begun |
| `progress` | `{ type, timestamp, message }` | Human-readable progress string; ignored for v1 |
| `info` | `{ type, timestamp, message }` | Info string; ignored for v1 |
| `error` | `{ type, timestamp, message }` | Error string |
| `message` | `{ type, timestamp, message: <SDKMessage> }` | Wrapped Claude Agent SDK message — see below |
| `question.asked` | `{ type, timestamp, questions: [{ question, options: [{ label, description }] }] }` | Agent called `AskUserQuestion`; questions/options already flattened |
| `turn.completed` | `{ type, timestamp, sessionId, status, usage? }` | Process is about to exit |

`status` on `turn.completed` is one of `success`, `error`, `paused`, `max_turns`.

There is **no** `init`-style event, and no top-level `session_id` on `message` events. Do not look for `subtype: "init"`.

### Capturing `session_id`

Two sources. Capture both; they should agree.

- On a `message` event where `event.message.type === 'result'`: read `event.message.session_id`.
- On the `turn.completed` event: read `event.sessionId`.

Always persist the captured `session_id` — even when the turn ends with `status: "paused"` — so the next Telegram message resumes the same conversation.

### Capturing the reply text

On a `message` event where `event.message.type === 'result'`: read `event.message.result`. This is the final assembled assistant text. Do not stitch together streamed `assistant` text chunks; that field is already complete.

`event.message.is_error === true` indicates the turn ended in an error; `event.message.result` is the error text.

### `AskUserQuestion` handling

Unlike in raw Claude Code mode, Studio's `--json` output does **not** require parsing `tool_use` blocks. Instead:

- When the agent calls `AskUserQuestion`, the child emits a `question.asked` event with `questions` already flattened to `{ question: string, options: string[] }`.
- The child then emits `turn.completed` with `status: "paused"` and exits cleanly.
- The "one spawn per turn" model still holds — `paused` is a normal turn terminus, not an error.

### Non-`result` message events

`event.message.type` can be `assistant`, `user`, `system`, `stream_event`, etc. (raw SDK message types). For v1, ignore all of them except `type === 'result'`. Do not attempt to render streamed chunks to Telegram.

## CLI surface

### Subcommand tree (daemon control)

```
studio code remote-session start [--no-detach] [--remote-chat-id <id>] [--remote-bot <name>]
studio code remote-session attach
studio code remote-session stop
studio code remote-session status
```

`start` is the canonical entry point and is detached by default. It forks a detached child via `child_process.spawn(... { detached: true, stdio: 'ignore', windowsHide: true })`, sets `STUDIO_REMOTE_SESSION_DAEMON_CHILD=1` on the child's environment, and waits up to 5s for the child to write `~/.studio/remote-session.pid` before returning success. The parent's call to `loadRemoteSessionConfig()` (before spawning) means a missing token surfaces in the foreground terminal rather than dying silently in the background. `--no-detach` keeps the process attached to the terminal and dedicated to the poll loop (no interactive REPL, no `AiChatUI`).

`attach` connects a terminal to the running daemon: it replays a 16 KB tail of `~/.studio/remote-session.log`, then streams new entries live in the same human-readable format used by the foreground (`--no-detach`) mode. Ctrl-C / SIGTERM detaches the terminal without stopping the daemon. Errors with exit 1 if no daemon is running. Recovers from log rotation (size shrinks → reset offset) and reports daemon exit when the PID stops being live.

`stop` reads the PID file, sends `SIGTERM`, polls for exit (up to 5s), then escalates to `SIGKILL`. The PID file is removed regardless of how the daemon exits. `runRemoteSession()`'s existing SIGTERM handler triggers the graceful detach path (poll-loop abort + Telegram detach status), so well-behaved stops still get a `🔴 Local agent detached.` message in the chat.

`status` reads the PID file, probes liveness via `process.kill(pid, 0)`, removes the file when it points to a dead PID, and prints `running (PID …)` or `not running` accordingly.

The detached child's `runRemoteSession()` checks the env var on entry and calls `installDaemonChildHooks()` to write its PID and register an `exit` handler (and a SIGHUP handler on POSIX) that removes the file. SIGINT/SIGTERM are intentionally not intercepted by the daemon hooks — the existing graceful-detach path in `runRemoteSession()` handles them, and the `exit` event still fires afterwards to clean up the file.

### Slash command

Inside an interactive `studio code` session, `/remote-session` (registered in `apps/cli/ai/slash-commands.ts`) drives the daemon. It is **never blocking** — every subcommand returns control to the REPL within a few hundred milliseconds. Subcommands:

- `/remote-session start` — validates config (so a missing token surfaces immediately), then spawns the detached daemon via the same `startDaemon()` helper used by `studio code remote-session start`. Reports the new PID via `ui.showSuccess` and updates the bottom-bar daemon indicator. If a daemon is already running, reports the existing PID and updates the indicator (idempotent).
- `/remote-session stop` — calls `stopDaemon()` and clears the indicator. Surfaces friendly messages for "already stopped", "needed SIGKILL", or "process refused to die".
- `/remote-session` with no subcommand pops an interactive picker (`Start` / `Stop`) and routes the selection to the handler above. Canceling the picker (Esc) is a no-op.

There is intentionally no `/remote-session status` slash command. The bottom-bar indicator (described below) already shows whether the daemon is running, and `studio code remote-session status` covers the out-of-REPL case.

Implementation notes:

- `SlashCommandDef.getArgumentCompletions(prefix)` returns `start | stop` so typing `/remote-session ` shows them in the autocomplete dropdown.
- The REPL dispatcher matches on the first whitespace token (`/${name} <args>` rather than exact-match) so the handler receives the full prompt and parses the subcommand itself.
- The bottom-bar **daemon indicator** (`PromptEditor.daemonStatusMessage`) is updated immediately by the `start`/`stop` handlers AND every 5s by a light `getDaemonStatus()` poll started by the REPL. The poll catches external start/stop (e.g. another terminal running `studio code remote-session stop`) and unexpected daemon death.

`RemoteSessionConfigError` (e.g. missing token) is shown via `ui.showError` rather than crashing the REPL — the user is told to authenticate via `/login` or set `STUDIO_REMOTE_TOKEN`.

The previous "blocking attach" design (where the REPL was held until detach) is permanently off the table: with the daemon, the REPL never blocks. `start`/`stop` here mean "spawn the daemon" and "terminate it again", not "start the poll loop in this process".

### Telegram-side meta-command

Inside the poll loop, before forwarding a polled message to `studio code`, check if the message text equals `/new` (case-insensitive, trimmed). If so:
1. Discard the stored `session_id`.
2. POST `🆕 Started a new conversation.` to Telegram.
3. Continue polling without invoking `studio code`.

This gives the Telegram user a way to reset history without needing access to the laptop.

## Configuration

Required: `token` only. Resolution order: CLI flags > environment variables > config file > WordPress.com OAuth fallback.

If `token` is missing from the first three sources, the controller falls back to the `accessToken` in `~/.studio/shared.json` — the same token that `studio code` `/login` writes. A logged-in user can therefore start a remote session with **no remote-session config at all**.

`bot` and `chat_id` are **optional**:

- When unset (the default for a logged-in user), the controller derives both per-message from each polled payload (`polled.chat_id`, `polled.bot`) and uses them as the reply target. The server's bearer token is the only auth boundary — any message the server returns is treated as authorized for this local agent.
- When set, they act as a **pin**:
  - `chat_id`: drop any inbound message whose `chat_id` does not match. Use for shared/kiosk workstations where you want to limit which Telegram chat can drive the agent.
  - `bot`: override the reply `bot` field, regardless of which bot the inbound message came through.

Config file: `~/.studio/remote-session.json`, mode `0600`. All fields optional except as noted above:

```json
{
  "base_url": "https://public-api.wordpress.com/wpcom/v2/telegram-bot",
  "token": "...",
  "bot": "my_test_bot",
  "chat_id": 236756880,
  "poll_interval_seconds": 2,
  "long_poll_timeout_seconds": 25,
  "max_message_chars": 3800,
  "turn_timeout_seconds": 300
}
```

Env var equivalents: `STUDIO_REMOTE_BASE_URL`, `STUDIO_REMOTE_TOKEN`, `STUDIO_REMOTE_BOT`, `STUDIO_REMOTE_CHAT_ID`.

The token MUST never be logged or echoed back to Telegram. There is no CLI flag for `token` (only `--remote-chat-id` and `--remote-bot`) so the bearer never lands in shell history or `ps` output.

### Behavior when `chat_id` is not pinned

- **No attach POST.** The controller has no chat to post to until the first message arrives, so the "🟢 attached" status is skipped. The local terminal still prints `Remote session attached → any chat authorized by the bearer.`
- **No detach POST and no exit POST** (same reason).
- **Per-chat session storage.** State is keyed by the `chat_id` observed in each polled message, so different chats keep independent `session_id`s.
- `/remote-session new` from inside the local REPL is a no-op (it doesn't know which chat to reset). Send `/new` from Telegram to reset the current chat's session instead.

Path helpers: add `getRemoteSessionConfigPath()` and `getRemoteSessionStatePath()` alongside the existing helpers in `tools/common/lib/well-known-paths.ts`. Both files live under `getConfigDirectory()` (`~/.studio/` by default; overridable via `DEV_CONFIG_DIR` / `E2E_SHARED_CONFIG_PATH`, matching the existing convention).

### How the child `studio code --json` is launched

Do **not** assume a `studio` binary exists on `PATH` — in development the CLI runs as `node apps/cli/dist/cli/main.mjs`.

Re-execute the current process's own entry:

```
spawn(process.execPath, [process.argv[1], 'code', '--json', ...args], {
  stdio: ['ignore', 'pipe', 'pipe'],
  env: process.env,
})
```

`text` from Telegram is passed as a single positional argv element, never interpolated into a shell string, and `shell` is never set. This satisfies the shell-injection acceptance test.

### Session state

Persisted separately from config: `~/.studio/remote-session-state.json`, mode `0600`.

```json
{
  "chat_id": 236756880,
  "session_id": "d09d3c77-c2a1-4a8e-81c9-d9f732da1412",
  "updated_at": "2026-04-22T09:31:29.003Z"
}
```

Written after each turn that captures a `session_id` (including paused turns). Read on attach to resume.

Use a dedicated lockfile (`~/.studio/remote-session-state.lock`) with the `lockfile` wrapper at `tools/common/lib/lockfile.ts`. Do not reuse the `shared.json` lock. After writing, `chmod 0o600` (follow the pattern used in `certificate-manager.ts`).

## Architecture

```
┌──────────────────────────────────────────┐
│  studio code remote-session daemon       │
│  (background process; out-of-REPL)       │
│                                          │
│  ┌────────────────────────────────────┐  │
│  │ remote-session controller          │  │
│  │                                    │  │
│  │ ┌────────────────────────────────┐ │  │
│  │ │ poll loop                      │ │  │   GET /local-agent-poll
│  │ │   while attached:              │ │──┼──────────► server
│  │ │     batch = poll()             │ │  │   ◄──────── { messages: [...] }
│  │ │     for msg in batch:          │ │  │
│  │ │       if msg.text == "/new":   │ │  │
│  │ │          clear session_id      │ │  │
│  │ │          ack to telegram       │ │  │
│  │ │          continue              │ │  │
│  │ │       reply = run_turn(msg)    │ │  │
│  │ │       post(reply)              │ │  │   POST /local-agent-respond
│  │ │                                │ │──┼──────────► server
│  │ └─────────┬──────────────────────┘ │  │
│  │           │                        │  │
│  │           ▼                        │  │
│  │ ┌────────────────────────────────┐ │  │
│  │ │ run_turn(text):                │ │  │
│  │ │   spawn: studio code --json    │ │──┼──► spawn child
│  │ │     [--resume-session <id>]    │ │  │    (one per turn,
│  │ │     "<text>"                   │ │  │     exits at turn.completed)
│  │ │   parse NDJSON from stdout     │ │  │
│  │ │   capture session_id           │ │  │
│  │ │   capture result text OR       │ │  │
│  │ │     flattened question.asked   │ │  │
│  │ │   persist session_id           │ │  │
│  │ │   return reply                 │ │  │
│  │ └────────────────────────────────┘ │  │
│  └────────────────────────────────────┘  │
└──────────────────────────────────────────┘
```

Three responsibilities, all owned by the controller:

1. **Poll loop** — drives the lifecycle, polls the server, handles `/new`, posts replies.
2. **Turn runner** — spawns one `studio code --json` per Telegram message, parses events, returns the reply text.
3. **State manager** — reads/writes the `session_id` to disk; clears it on `/new` or `/remote-session new`.

No PTY, no long-lived child, no shared state between processes. The `session_id` on disk is the entire state.

## Lifecycle

### Attach (from flag or `/remote-session attach`)

1. Validate config: `token` must be resolvable (config / env / CLI / WP.com OAuth fallback). On failure, exit non-zero with a clear local error. Do not retry.
2. **If `chat_id` is pinned in config**:
   - Load state file; capture any existing `session_id` for that chat.
   - POST status to Telegram: `🟢 Local agent attached. Working dir: <cwd>. <resume_note>` where `<resume_note>` is `Resuming previous session.` if a session_id was loaded, else `New session.`. If the POST fails, abort attach and surface the error locally.
   - Print: `Remote session attached → chat <chat_id>.`
3. **Otherwise** (no pin):
   - Skip the attach POST (no chat to post to until the first message arrives).
   - Print: `Remote session attached → any chat authorized by the bearer.`
4. Set state to `attached`. Start the poll loop.

### Poll loop

```
while attached:
    try:
        batch = GET /local-agent-poll  (long-poll, timeout = long_poll_timeout_seconds)
                # batch is the `messages` array from the server response.
        if batch is empty:
            sleep(poll_interval_seconds)
            continue

        # Drain the batch sequentially. One message = one studio code --json turn.
        # Concurrency: poll loop blocks until the whole batch is processed before
        # the next GET — matches the server-side per-chat lock.
        for msg in batch:
            if detach_requested:
                break

            # Optional pinning: only filter when the user set `chat_id` in config.
            if config.chat_id is not None and msg.chat_id != config.chat_id:
                log_warning("ignoring message for chat {msg.chat_id}; bound to {config.chat_id}")
                continue

            # Reply target is derived per-message. config.bot, if set, overrides polled.bot.
            target = { chat_id: msg.chat_id, bot: config.bot or msg.bot }
            text = msg.message.strip()  # NB: server's field name is `message`, not `text`.

            if text.lower() == "/new":
                clear_session_id(msg.chat_id)
                post_to_telegram(target, "🆕 Started a new conversation.")
                continue

            reply = run_turn(text, turn_timeout_seconds)
            if reply is None:
                post_to_telegram(target, "⚠️ Local agent did not return a result.")
                continue

            post_chunks_to_telegram(target, reply)

    except network_error:
        sleep(backoff)  # exponential, cap 30s
    except auth_error (401/403):
        post_to_telegram("⚠️ Bad token; detaching.")  # best-effort
        detach()
        break
    except fatal:
        log(error)
        detach()
        break
```

### `run_turn(text, timeout)`

1. Build command: `[process.execPath, process.argv[1], 'code', '--json']`. If a stored `session_id` exists for this chat, append `['--resume-session', session_id]`. Append `text` as the final positional argv element.
2. Spawn the child with stdout piped, stderr captured to a log buffer, cwd inherited from the controller's process. Never use a shell.
3. Read stdout line-by-line as NDJSON. For each line:
   - Parse JSON. On parse error, log + skip the line.
   - `event.type === 'message'` AND `event.message.type === 'result'`:
     - Capture `event.message.session_id` as `capturedSessionId`.
     - Capture `event.message.result` as `replyText`.
     - If `event.message.is_error === true`, mark the reply as an error (prefix `⚠️ ` when posting).
   - `event.type === 'question.asked'`:
     - Capture `event.questions` as `pausedQuestions`.
   - `event.type === 'turn.completed'`:
     - Capture `event.sessionId` (prefer this over the result event's value if both present; they should match).
     - Capture `event.status`.
     - Stop reading.
   - All other event types (`turn.started`, `progress`, `info`, `error`, non-`result` `message` events): ignore for v1.
4. Wait for the child to exit. If it does not exit within 5s after `turn.completed`, SIGTERM, then SIGKILL after 2s more.
5. If the child exceeds `turn_timeout_seconds` overall: SIGTERM, then SIGKILL after 2s. Return `None`.
6. If `capturedSessionId` is set and differs from the on-disk one (or none was on disk), persist it to the state file — **including** when `status === 'paused'`, so the next Telegram message can resume and answer the pending question.
7. Return the extracted reply (see "Reply extraction" below).

### Detach (from `/remote-session detach`, Ctrl-C, or fatal error)

1. Set state to `detached`. Poll loop exits at next iteration boundary.
2. POST `🔴 Local agent detached.` to Telegram.
3. Print to local terminal: `Remote session detached.`
4. Leave the `session_id` on disk so a future attach resumes seamlessly.

### `/remote-session new`

1. Clear the `session_id` from disk.
2. POST `🆕 Started a new conversation.` to Telegram.
3. Print to local terminal: `Remote session reset.`
4. Continue polling normally.

### Process exit

- Parent process exit while attached: best-effort POST `🔴 Local agent ended (process exit).` (timeout 2s, do not block exit). Leave `session_id` intact.

## Reply handling

### Reply extraction

Given the captured values from a single turn, produce the reply text:

1. If `replyText` is non-empty AND no `question.asked` was seen → use `replyText` verbatim. If the turn's result was flagged as error, prepend `⚠️ `.
2. If `question.asked` was seen → format the flattened questions as Markdown (see below). If `replyText` is also non-empty (the agent wrote a lead-in before asking), prepend it with a blank line separator.
3. Otherwise (no result text, no question) → return `None`. The caller posts `⚠️ Local agent did not return a result.`.

There is no need to concatenate `assistant` text chunks — the `result` field is already the final assembled message.

### Formatting `question.asked` for Telegram

`question.asked.questions` is already `[{ question: string, options: [{ label: string, description: string }] }]`. No parsing of raw `tool_use` input. The `description` is a short hint the UI shows next to each option; include it after the label when it adds information.

Format for a single question:

```
**<question text>**

- A) <label 1> — <description 1>
- B) <label 2> — <description 2>
- C) <label 3>
- _Or reply with anything else for "Other"._
```

Omit ` — <description>` when the description is empty or identical to the label.

For multiple questions in one event, number them and ask the user to reply with one answer per line (or any free-form text — the agent will parse it on the next turn).

The user's free-form reply is sent verbatim as the next turn's prompt. The agent in the resumed session sees the answer in conversation context and continues. The controller does NOT try to parse the user's answer or map it back to option indices — that's the agent's job.

### Chunking

Telegram caps message bodies at 4096 chars. Use `max_message_chars` (default 3800).

- Split on paragraph boundaries (`\n\n`) first, then sentence boundaries, then hard wrap.
- Code blocks (` ``` `) MUST NOT be split mid-block. If a single code block exceeds the limit, split it into multiple labeled blocks: `(part N/M)`.
- Each chunk is one POST to `/local-agent-respond`, awaiting 200 OK before sending the next, to preserve order.

### Markdown handling

`studio code` returns Markdown via the result event. Pass through unchanged in v1; the server-side already handles Markdown→Telegram-HTML conversion for the existing WordPress Agent path (formerly known as Dolly). The implementing agent MUST verify this against the `/local-agent-respond` endpoint before coding (see Open question 1 below).

If conversion is NOT done server-side, do minimal local processing: strip ANSI escape codes, leave Markdown as-is.

## Multi-turn flows

The agent can ask the Telegram user a question mid-flow and wait for an answer. This works automatically because each polled Telegram message resumes the same session via `--resume-session <session_id>`. From the controller's perspective, every turn is the same: spawn → parse → post → exit.

There are two patterns the agent uses:

### Pattern 1: Plain-text question

The agent asks a question in its `result` text. Example: a skill instructs the agent to ask "What's the name of your Rubik's Cube club?" in plain text and stop. The turn completes with `status: "success"` and the question as `result`. No special handling — the controller posts it to Telegram, the user replies, and the next polled message becomes the next turn's prompt within the same resumed session.

### Pattern 2: Structured `AskUserQuestion` tool call

The agent calls the `AskUserQuestion` tool. In `--json` standalone mode:

1. Studio emits a `question.asked` event with the flattened `questions` array.
2. Studio emits `turn.completed` with `status: "paused"`.
3. The child exits cleanly.

The controller formats the `question.asked` event as Markdown (see "Formatting `question.asked` for Telegram") and posts it. The next polled message is treated as the answer and sent to a resumed turn.

### No "waiting" state

The controller does NOT track whether the agent is "waiting on the user." It just polls and resumes. Paused vs. success vs. error all yield the same flow: post the reply, persist `session_id`, keep polling. This keeps the design stateless beyond the on-disk `session_id`.

## Errors

| Condition | Behavior |
|---|---|
| Poll returns 401/403 | Post `⚠️ Bad token; detaching.`, detach, exit non-zero |
| Poll returns 5xx | Exponential backoff, cap 30s, keep trying |
| Poll network timeout | Treat as empty, continue |
| Respond returns 4xx | Log locally, do NOT retry (likely malformed payload). Continue polling. |
| Respond returns 5xx | Retry up to 3x with backoff, then drop and log. Continue polling. |
| `studio code` exits non-zero | Capture stderr tail, post `⚠️ Local agent error: <stderr first 500 chars>` to Telegram, continue polling |
| `run_turn` timeout | Kill child, post `⚠️ Turn took too long; aborted.`, continue polling |
| `run_turn` returns no reply (no `result`, no `question.asked`) | Post `⚠️ Local agent did not return a result.`, continue polling |
| `--resume-session <id>` fails (invalid/expired session) | Detect via non-zero exit + empty result (confirm exact signal in phase 0 — see Open question 3), clear `session_id`, retry the turn once with no `--resume-session` flag, post `ℹ️ Session expired; started a new one.` |

All user-visible errors MUST NOT include the bearer token or full URLs containing it.

## Concurrency

- One in-flight turn at a time. While `run_turn` is running, the poll loop blocks. This matches the server-side per-chat lock.
- For v1, the interactive REPL is blocked while attached (see "CLI surface → Slash command" note). There is no cross-thread shared state to guard.

## Logging

Log file: `~/.studio/remote-session.log`, rotated at 10MB, keep 3.

INFO-level events: attach, detach, `/new`, each polled message (chat_id and first 80 chars of text), each spawned turn (with `session_id`, duration_ms, output_chars, `turn.completed.status`), each respond call (chunk count and char total), all errors with redacted URLs.

DEBUG-level (only when `STUDIO_REMOTE_DEBUG=1`): full request/response bodies with token redacted, full NDJSON event stream from the child.

## Security checklist

- [ ] Token never written to log files in cleartext.
- [ ] Token never sent in any Telegram message body.
- [ ] Config file and state file created with mode `0600`.
- [ ] Polled message text is only ever passed as a positional argv to `studio code` — never interpolated into a shell string. Use `spawn()` without `shell: true`, not `exec()` or `sh -c`.
- [ ] Network calls go only to the configured `base_url` host. Reject redirects to other hosts.
- [ ] No retry of inbound polled messages — once polled, a dropped message is dropped (server can re-send if needed).

## Acceptance criteria

1. `studio code remote-session start` (detached daemon, default) or `studio code remote-session start --no-detach` (foreground) starts a process that begins polling. No interactive UI is shown. If `chat_id` is pinned in config, the process also POSTs an "attached" status to that chat before the first poll; without a pin, attach is silent on the Telegram side.
2. From an interactive `studio code` session, `/remote-session attach` spawns the daemon (idempotent if one is already running) and updates the bottom-bar indicator. The REPL stays interactive — the daemon does the polling out-of-process, and the user keeps typing locally.
3. A Telegram message routed to the local agent appears in the chat as a reply within `poll_interval + studio_code_turn_duration + ~2s` end-to-end.
4. The second and subsequent Telegram messages are processed in the **same** `studio code` session (verified by the agent referring back to earlier turns).
5. `/new` (Telegram) resets the session; the next message starts fresh and the agent has no memory of prior turns.
6. `/remote-session detach` (REPL) stops the daemon and clears the indicator; the next `/remote-session attach` (or `studio code remote-session start`) resumes the same session because `session_id` is left on disk.
7. Replies longer than 4096 characters are split into multiple Telegram messages in order, with code blocks intact.
8. Killing the daemon process posts a best-effort detach status to Telegram and leaves the `session_id` intact for the next attach.
9. With an invalid token, the daemon fails fast with a clear local error and does NOT enter a retry loop.
10. While a turn is being processed, no new poll request is made until the reply has been posted (or the turn has timed out).
11. If `--resume-session` fails because the session is stale, the controller silently retries with a fresh session and posts a one-line notice to Telegram.
12. The token does not appear in any log line, error message, or Telegram message under any tested condition.
13. The polled message text cannot trigger shell injection — verified by sending a message containing `; rm -rf /tmp/test-canary` (with a sentinel file in place) and confirming the file remains.
14. Multi-turn flow works end-to-end: send "Create a site for my Rubik's Cube club" via Telegram → agent asks for the club name in plain text (Pattern 1: ends with `turn.completed.status === "success"` and a question in `result`) → user replies with a name → agent asks the one-page-vs-multi-page question via `AskUserQuestion` (Pattern 2: emits `question.asked`, ends with `turn.completed.status === "paused"`; the controller renders the questions as Markdown and persists `session_id`) → user replies with their choice → agent calls `site_create` and reports completion. All turns share the same `session_id`.

## Open questions for the implementing agent to resolve

1. Confirm whether `/local-agent-respond` accepts Markdown and converts to Telegram HTML, or expects pre-formatted HTML. (Check against the existing Telegram channel response path on the server.)
2. Confirm how `studio code` signals a stale/invalid `--resume-session <id>` — stderr text, exit code, a `turn.completed.status === "error"` with a specific result payload, or all of the above. One scripted invocation with a bogus UUID is enough.
3. Confirm whether `studio code` writes anything to stderr during normal `--json` operation that the controller should treat as an error indicator vs. benign noise.
