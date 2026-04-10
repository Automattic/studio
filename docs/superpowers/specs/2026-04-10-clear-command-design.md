# `/clear` Command for `studio code`

**Status:** Design approved, pending implementation plan
**Date:** 2026-04-10

## Problem

The `studio code` REPL (the interactive AI agent built on `@anthropic-ai/claude-agent-sdk`) has no way to clear the current conversation and start fresh without killing the process. Users who finish one task and want to start another on the same site must hit `Ctrl+C` and re-launch `studio code`, losing their provider selection, model choice, and active site along the way. This design adds a `/clear` slash command that wipes conversation state in place.

## Goals

- Let users start a new conversation without restarting the process.
- Preserve all ambient user state: active site, model, provider.
- Leave the on-disk transcript intact (for debugging and for `--resume`), but make `--resume` show only the post-clear portion of the conversation.
- Match the behavior of every other slash command in the REPL (processed between turns, no mid-turn handling).

## Non-goals

- No native SDK "clear" API call. The Agent SDK has no such API; session continuity is managed entirely client-side by holding and passing a `sessionId`. Dropping that reference is the entire "clear" mechanism.
- No mid-turn clear. The input loop only reads new input via `ui.waitForInput()` between turns, so there is no in-flight agent to interrupt.
- No confirmation prompt. `/clear` is non-destructive on disk and easily undone via `studio code --resume`.
- No keyboard shortcut. Typed `/clear` only, for consistency with `/exit`, `/model`, etc.
- No changes to the `studio ai` legacy alias path.
- No reset of model, provider, or active site.

## Behavior

When the user types `/clear` at the input prompt, Studio does the following, synchronously, between turns:

1. Drops the local `sessionId` variable so the next `query()` call omits the `resume` option, starting a brand-new Agent SDK session.
2. Removes all children from `AiChatUI.messages` and requests a re-render, leaving a fully blank transcript. No welcome banner, no confirmation line.
3. Appends a `session.cleared` event to the current recorder file.
4. Re-emits the current `session.context` (provider + model) to the recorder so it lands in the post-clear window.
5. If a site is active, re-emits the current `site.selected` event to the recorder so it also lands in the post-clear window.
6. Preserves everything else: active site selection, current model, current provider, UI status message.

The recorder file is **not** rotated. One Studio run still produces one transcript file, consistent with how the recorder treats error-reset turns today.

## Replay semantics

On `studio code --resume <session>`, the user sees only the conversation after the most recent `/clear`. The rule is implemented as a single slice in the replay loader:

1. Load the event array from disk as today.
2. Find the index of the **last** `session.cleared` event (not the first — multiple clears in one run should show only content after the most recent).
3. If found, slice the array from `index + 1` and pass the slice to the existing rendering logic. Otherwise, pass the full array (current behavior unchanged).

Because `/clear` re-emits `session.context` and `site.selected` immediately after the clear marker, the post-clear slice is self-contained: it always begins with a context and (if applicable) a site event, so the replay renderer needs no special-case knowledge of clear semantics. The replay code stays dumb; the recorder file remains a plain event log any future tool can read without understanding clear semantics.

## Implementation touch points

### `apps/cli/ai/slash-commands.ts`

Add the constant and registry entry:

```ts
export const AI_CHAT_CLEAR_COMMAND = '/clear';
```

Append to `AI_CHAT_SLASH_COMMANDS`:

```ts
{ name: 'clear', description: __( 'Clear the conversation and start a fresh session' ) }
```

### `apps/cli/ai/sessions/types.ts`

Add `session.cleared` to the `AiSessionEvent` discriminated union:

```ts
{ type: 'session.cleared'; timestamp: string }
```

### `apps/cli/ai/sessions/recorder.ts`

Add a `recordSessionCleared()` method that appends a `session.cleared` event with the current ISO timestamp via the existing `appendEvent()` helper.

### `apps/cli/ai/sessions/replay.ts` (and its event loader)

When iterating loaded events, use `findLastIndex` to locate the last `session.cleared` marker and slice from `index + 1` before passing to the existing replay rendering logic. If no clear event is present, behavior is identical to today.

### `apps/cli/ai/ui.ts`

Add a public `clearTranscript()` method on `AiChatUI` that:

- Removes all children from `this.messages` (the `Container` created at `apps/cli/ai/ui.ts:617`).
- Resets transient rendering state: `currentMarkdown = null`, `currentResponseText = ''`.
- Calls `this.tui.requestRender()`.

No welcome splash and no confirmation line — fully blank as specified.

### `apps/cli/commands/ai/index.ts`

In the `while ( true )` input loop, add a new handler branch alongside the other slash-command handlers. Its body, in order:

1. `sessionId = undefined;`
2. `ui.clearTranscript();`
3. `await persist( ( recorder ) => recorder.recordSessionCleared() );`
4. `await persistSessionContext();` — re-emits provider + model into the post-clear window.
5. If `ui.activeSite`, `await persist( ( recorder ) => recorder.recordSiteSelected( { ... } ) );` — re-emits the active site into the post-clear window.
6. `continue;`

The existing `persist()` helper serializes writes through `persistQueue`, so steps 3–5 are guaranteed to land in file order without interleaving with concurrent recorder writes.

## Testing

Add tests mirroring the existing layout in `apps/cli/ai/sessions/tests/` and `apps/cli/commands/ai/tests/`:

- **Recorder:** `recordSessionCleared()` appends a well-formed `session.cleared` event with a valid timestamp.
- **Replay (with clear):** given a fixture with events before and after a `session.cleared` marker, only post-clear events are replayed.
- **Replay (no clear):** behavior is identical to today (all events replay).
- **Replay (multiple clears):** only events after the **last** `session.cleared` marker are replayed.
- **Replay (post-clear context/site):** the re-emitted `session.context` and `site.selected` events after a clear marker replay correctly, restoring ambient state in the resumed session.
- **REPL handler:** typing `/clear` drops `sessionId`, clears the UI transcript, and writes the expected three-event sequence (`session.cleared`, `session.context`, optional `site.selected`) to the recorder in that order.

## Risks and mitigations

- **Recorder file grows unbounded across many clears.** Each clear adds three events (`session.cleared`, `session.context`, optional `site.selected`), which is negligible. No mitigation needed.
- **`findLastIndex` availability.** Node.js LTS versions targeted by Studio support `Array.prototype.findLastIndex` (ES2023). Confirm during implementation; if unavailable, a reverse `for` loop is a trivial substitute.
- **Race with a still-queued `persist()` write.** The `persistQueue` promise chain guarantees FIFO ordering, so any writes scheduled before `/clear` will land before the `session.cleared` marker. No extra synchronization needed.