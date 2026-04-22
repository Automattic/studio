# Spec: `studio code` Remote Session (Telegram bridge)

## Overview

Add a "remote session" capability to the `studio code` CLI that lets the user drive `studio code` from Telegram. Each Telegram message arriving at the WordPress.com server is delivered to `studio code` as a new turn, and each assistant reply is posted back to Telegram.

The server side already exists. This spec covers only the local CLI changes.

## Goals

- One Telegram chat is bound to one resumable `studio code` session at a time. Each Telegram message resumes that session, runs one turn, and exits.
- The Telegram session shares history across messages (via `--resume-session`), and can be reset on demand.
- Two entry points to the same feature:
  - **Autostart flag**: `studio code --remote-session` enters remote mode immediately.
  - **Slash command**: `/remote-session attach|detach|new|status` toggles remote mode from inside an interactive `studio code` session.
- Fully autonomous: tool calls and file modifications proceed without per-message approval (the underlying agent already supports `--auto-approve`).
- Outbound-only network from the laptop (poll + post). No inbound ports, no tunnel, no PTY plumbing.

## Non-goals (v1)

- Multi-chat binding. v1 binds one chat per laptop, configured once.
- Per-message approval flow from Telegram.
- Forwarding intermediate progress events (`progress`, `info`, streamed assistant chunks, tool_use events) to Telegram. Only the final `result` text (or, for a paused turn, the flattened `question.asked`) is posted.
- Running a remote poll loop in parallel with an active interactive REPL. v1 blocks the REPL while attached; the user detaches to resume typing locally. A future version can revisit parallelism.

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

### Flag

```
studio code --remote-session [--remote-chat-id <id>] [--remote-bot <name>]
```

Behavior: start `studio code` in **remote-only** mode (no interactive REPL, no `AiChatUI`). The process is dedicated to running the poll loop. Equivalent to launching the poll loop directly with the configured chat binding.

This mode is intended for running under launchd or in a terminal tab dedicated to the bridge. Implementation: when `--remote-session` is present, the `studio code` handler short-circuits before instantiating any UI adapter and hands off to `runRemoteSession()`.

### Slash command

Inside an interactive `studio code` session, register `/remote-session` in `apps/cli/ai/slash-commands.ts` (`AI_CHAT_SLASH_COMMANDS`) with these subcommands:

```
/remote-session              # alias of `status`
/remote-session status       # show: attached?, chat_id, current session_id, last poll, queue depth
/remote-session attach       # block the REPL and run the poll loop until detached
/remote-session detach       # signal the running loop to exit (if we implement a parallel mode later)
/remote-session new          # discard current Telegram session_id; next message starts fresh
```

**Dispatcher extension required.** The current slash-command dispatcher (`apps/cli/commands/ai/index.ts`, around the `AI_CHAT_SLASH_COMMANDS.find(...)` call) is an **exact-match** lookup:

```ts
const cmd = AI_CHAT_SLASH_COMMANDS.find( c => `/${ c.name }` === trimmedPrompt );
```

This must be extended to match on the first whitespace-separated token and pass the remainder of the input to the handler as an argument string. The change is backward-compatible — existing handlers ignore the extra argument — and needs a small regression test for existing no-arg commands (`/clear`, `/login`, etc.).

Notes:
- For v1, `/remote-session attach` blocks the interactive REPL until the poll loop exits (Ctrl-C, `detach` over an alternate control channel, or fatal error). Running the poll loop truly concurrently with an active TUI is out of scope for v1 because `@mariozechner/pi-tui` owns stdin and the terminal. A parallel mode can be added later without breaking this spec.
- `/remote-session` is registered with a handler (not as a skill passthrough), following the pattern of `/clear`, `/login`, etc.

### Telegram-side meta-command

Inside the poll loop, before forwarding a polled message to `studio code`, check if the message text equals `/new` (case-insensitive, trimmed). If so:
1. Discard the stored `session_id`.
2. POST `🆕 Started a new conversation.` to Telegram.
3. Continue polling without invoking `studio code`.

This gives the Telegram user a way to reset history without needing access to the laptop.

## Configuration

Read from, in priority order: CLI flags > environment variables > config file.

Config file: `~/.studio/remote-session.json`, mode `0600`.

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

The token MUST never be logged or echoed back to Telegram.

### Why `chat_id` and `bot` are pre-configured (and not just read from each polled message)

The poll response carries `chat_id` and `bot` per message (see "Server contract"), so it might look like the controller could derive both at runtime and skip configuration entirely. Both stay in config on purpose:

- **`chat_id` is a scoping/security fence.** The controller drops any polled message whose `chat_id` does not match `config.chat_id`. Without this binding, anyone who sends a message to the bot drives your laptop. The chat_id is *not* used to construct the reply target — it's used to filter inbound messages.
- **`bot` pins the reply identity.** When responding, the controller defaults `body.bot` to `config.bot`. The poll response's `bot` is *not* echoed straight back; pinning it in config means a malformed or rogue inbound message can't trick the controller into replying through a different bot identity.

There is no CLI flag for `token` (only `--remote-chat-id` and `--remote-bot`) so the bearer never lands in shell history or `ps` output.

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
│  studio code process                     │
│  (interactive OR --remote-session mode)  │
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

1. Validate config (token, bot, chat_id present). On failure, exit non-zero with a clear local error naming the missing fields. Do not retry.
2. Load state file; capture any existing `session_id` for the configured chat.
3. POST status to Telegram: `🟢 Local agent attached. Working dir: <cwd>. <resume_note>` where `<resume_note>` is `Resuming previous session.` if a session_id was loaded, else `New session.`. If the POST fails, abort attach and surface the error locally.
4. Set state to `attached`. Start the poll loop.
5. Print to local terminal: `Remote session attached → chat <chat_id>.`

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

            if msg.chat_id != config.chat_id:
                log_warning("ignoring message for chat {msg.chat_id}; bound to {config.chat_id}")
                continue

            text = msg.message.strip()  # NB: server's field name is `message`, not `text`.

            if text.lower() == "/new":
                clear_session_id()
                post_to_telegram("🆕 Started a new conversation.")
                continue

            reply = run_turn(text, turn_timeout_seconds)
            if reply is None:
                post_to_telegram("⚠️ Local agent did not return a result.")
                continue

            post_chunks_to_telegram(reply)

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

`studio code` returns Markdown via the result event. Pass through unchanged in v1; the server-side already handles Markdown→Telegram-HTML conversion for the existing Dolly path. The implementing agent MUST verify this against the `/local-agent-respond` endpoint before coding (see Open question 1 below).

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

1. `studio code --remote-session` starts a process that immediately POSTs the "attached" status to Telegram and begins polling. No interactive UI is shown.
2. From an interactive `studio code` session, `/remote-session attach` starts the poll loop; for v1 this blocks the REPL until the user detaches.
3. A Telegram message routed to the local agent appears in the chat as a reply within `poll_interval + studio_code_turn_duration + ~2s` end-to-end.
4. The second and subsequent Telegram messages are processed in the **same** `studio code` session (verified by the agent referring back to earlier turns).
5. `/remote-session new` (laptop) and `/new` (Telegram) both reset the session; the next message starts fresh and the agent has no memory of prior turns.
6. `/remote-session detach` (or Ctrl-C) stops polling and posts a detach status; on a later `/remote-session attach`, the same session resumes.
7. Replies longer than 4096 characters are split into multiple Telegram messages in order, with code blocks intact.
8. Killing the `studio code` process while attached posts a best-effort detach status to Telegram and leaves the `session_id` intact for the next attach.
9. With an invalid token, attach fails fast with a clear local error and does NOT enter a retry loop.
10. While a turn is being processed, no new poll request is made until the reply has been posted (or the turn has timed out).
11. If `--resume-session` fails because the session is stale, the controller silently retries with a fresh session and posts a one-line notice to Telegram.
12. The token does not appear in any log line, error message, or Telegram message under any tested condition.
13. The polled message text cannot trigger shell injection — verified by sending a message containing `; rm -rf /tmp/test-canary` (with a sentinel file in place) and confirming the file remains.
14. Multi-turn flow works end-to-end: send "Create a site for my Rubik's Cube club" via Telegram → agent asks for the club name in plain text (Pattern 1: ends with `turn.completed.status === "success"` and a question in `result`) → user replies with a name → agent asks the one-page-vs-multi-page question via `AskUserQuestion` (Pattern 2: emits `question.asked`, ends with `turn.completed.status === "paused"`; the controller renders the questions as Markdown and persists `session_id`) → user replies with their choice → agent calls `site_create` and reports completion. All turns share the same `session_id`.

## Open questions for the implementing agent to resolve

1. Confirm whether `/local-agent-respond` accepts Markdown and converts to Telegram HTML, or expects pre-formatted HTML. (Check against the existing Telegram channel response path on the server.)
2. Confirm how `studio code` signals a stale/invalid `--resume-session <id>` — stderr text, exit code, a `turn.completed.status === "error"` with a specific result payload, or all of the above. One scripted invocation with a bogus UUID is enough.
3. Confirm whether `studio code` writes anything to stderr during normal `--json` operation that the controller should treat as an error indicator vs. benign noise.
