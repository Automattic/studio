# Agent SDK: Consistent "Continue?" Prompt for Subagent Max-Turns

**Status:** Draft
**Date:** 2026-04-15
**Owner:** @wesleyfantinel
**Branch:** `update/agent-sdk-turn-limit-behavior-and-recovery`

## Problem

Studio's CLI AI wraps the Claude Agent SDK. When the **outer** agent hits the 50-turn cap, the SDK emits a `result` message with `subtype === 'error_max_turns'`, and `apps/cli/commands/ai/index.ts` asks the user *"Reached the turn limit. Continue?"* (see `commands/ai/index.ts:441-463`, `ui.ts:2187`, `output-adapter.ts:117`).

When a **subagent** (a Claude Code run spawned via the `Task` tool) hits its own turn cap, the failure is surfaced as a `tool_result` whose content starts with the literal string:

> `Claude Code returned an error result: Reached maximum number of turns (50)`

The outer agent sees it as a regular tool error, may keep going briefly or render it as its final assistant message, and the outer `error_max_turns` branch never fires. The continue prompt never appears. A real user hit exactly this: the outer turn ended with the bare error line after a long WooCommerce setup run, with no way to resume inline.

The user experience goal is **"the agent tells you 'I've been running a long time, are you sure you want me to continue?' — consistently, regardless of which layer actually ran out."**

## Goal

Detect subagent max-turns events during an outer turn and, after the turn completes, offer the same "Continue?" prompt the outer max-turns path offers today — ideally pre-populated with the subagent's last visible progress so the resume instruction is useful instead of generic.

## Non-goals

- Raising `maxTurns` globally. A bumped cap doesn't add the feedback the user is asking for.
- Cross-layer turn counting (Option C from brainstorming). Can be revisited if B proves insufficient.
- Changing how the outer `error_max_turns` path works today.
- New UI for subagent progress visualization.

## Design

### Components

Three touch points:

1. **Detector** — in `apps/cli/ai/ui.ts`, inside `handleMessage`.
2. **Shared prompt helper** — extracted from the existing inline prompt in `apps/cli/commands/ai/index.ts:449-462`.
3. **Prompt trigger** — post-loop in `apps/cli/commands/ai/index.ts`, after the existing outer `max_turns` check.

### Detector (`ui.ts`)

Add per-turn state on the UI class:

```ts
private subagentMaxTurns: { lastProgress: string | null } | null = null;
```

Reset at the start of each turn (same place `turnStartTime` / `wasInterrupted` are reset).

Inside `handleMessage`, when a `tool_result` message arrives for a `Task` tool call:

1. **Structured check first**: if the SDK exposes `is_error: true` and a subtype or categorized error for max-turns, branch on that.
2. **Fallback string match**: test the content for `Reached maximum number of turns`.

If matched:

- Extract `lastProgress` — the last visible assistant text from the subagent's streamed output, if available in the tool_result payload. Truncate to ~200 chars.
- Set `this.subagentMaxTurns = { lastProgress }`. If multiple subagents trigger this in one outer turn, overwrite (keep the last).

The detector does not suppress or rewrite the tool_result. The outer agent still sees the failure as a normal tool error and can react in-stream. The flag only informs the post-turn prompt.

### Shared helper (`commands/ai/index.ts`)

Extract the existing inline prompt into a helper:

```ts
type ContinueReason =
  | { kind: 'outer'; numTurns: number }
  | { kind: 'subagent'; lastProgress: string | null };

async function maybePromptContinue(
  ui: UiAdapter,
  reason: ContinueReason
): Promise<{ resumePrompt: string } | null>;
```

Question text:

- `outer` → *"Reached the turn limit. Continue?"* (unchanged)
- `subagent` + `lastProgress` → *"A subagent hit its turn limit. Last progress: '<snippet>'. Continue?"*
- `subagent` no progress → *"A subagent hit its turn limit mid-task. Continue?"*

Resume prompt text (sent back through `runAgentTurn` on "Yes"):

- `outer` → `"Continue from where you left off."` (unchanged)
- `subagent` + `lastProgress` → `"Your previous Task subagent stopped at: '<lastProgress>'. Re-dispatch the Task with a more focused scope to continue from there, or complete the remaining work inline."`
- `subagent` no progress → `"Your previous Task subagent hit its turn limit. Re-dispatch the same Task with a more focused scope (e.g. smaller batch), or complete the remaining work inline without a subagent."`

All user-visible strings wrapped in `__()` for i18n.

Returns `null` if the user picks "No".

### Prompt trigger (`commands/ai/index.ts`)

Replace the current inline block at lines 441-463 with:

```ts
let continueReason: ContinueReason | null = null;

if ( maxTurnsResult ) {
  continueReason = { kind: 'outer', numTurns: maxTurnsResult.numTurns };
} else if ( turnStatus !== 'interrupted' && ui.subagentMaxTurns ) {
  continueReason = {
    kind: 'subagent',
    lastProgress: ui.subagentMaxTurns.lastProgress,
  };
}

if ( continueReason ) {
  const resume = await maybePromptContinue( ui, continueReason );
  if ( resume ) {
    ui.addUserMessage( 'Continue' );
    return runAgentTurn( resume.resumePrompt );
  }
}
```

Priority: outer max-turns beats subagent max-turns. Never double-prompt in one turn.

## Data flow

```
SDK stream → ui.handleMessage(message)
  ├─ Task tool_result with max-turns marker
  │   → ui.subagentMaxTurns = { lastProgress }
  └─ outer result with subtype === 'error_max_turns'
      → returns { type: 'max_turns', ... }

Outer loop (commands/ai/index.ts) after stream ends:
  if outer max_turns      → maybePromptContinue({ kind: 'outer', numTurns })
  else if subagent flag   → maybePromptContinue({ kind: 'subagent', lastProgress })
                            (skipped when turnStatus === 'interrupted')
  else                    → done

On "Yes" → runAgentTurn(resumePrompt)  // recursive, resets flag at turn start
On "No"  → exit turn normally
```

## Edge cases

- **User interrupted (ESC)**: do not prompt. Honored via `turnStatus !== 'interrupted'` guard.
- **Outer turn errored for a different reason after a subagent max-turns**: still prompt — the subagent stall is the root cause worth surfacing.
- **Multiple subagent max-turns in one outer turn**: keep only the last `lastProgress` (overwrite policy in the detector).
- **Both outer and subagent max-turns in the same turn**: outer wins (priority rule).
- **JSON/headless mode (`--json`)**: no interactive prompt. Extend the `turn_completed` event payload with `max_turns_scope: 'outer' | 'subagent'` so headless consumers see which layer ran out. Existing `TurnCompletedStatus` already includes `'max_turns'`.
- **SDK error string changes in a future version**: structured detection is tried first; string-match is the fallback. A unit test pins the current exact string so a future SDK bump breaks the test loudly rather than silently skipping the prompt.
- **`lastProgress` extraction fails**: gracefully falls back to option B phrasing (no "stopped at" fragment).

## Testing

- **Detector unit test** (`ui.ts`): feed a synthetic `Task` `tool_result` message whose content contains `Reached maximum number of turns`, assert `subagentMaxTurns` gets set with `lastProgress` extracted and truncated. Separate case: marker present but no extractable progress → `lastProgress === null`.
- **Shared-helper unit test**: three cases (`outer`, `subagent` + progress, `subagent` no progress) produce the expected question and resume prompt strings.
- **SDK-string regression test**: pin the literal `'Reached maximum number of turns'` substring behind a constant with a comment explaining the coupling.
- **Integration test** in `commands/ai/index.ts`: mock an agent query that streams a Task tool_result containing the marker followed by a successful outer `result`; assert the prompt fires and that answering "Yes" triggers `runAgentTurn` with the subagent resume prompt string.
- **Interruption guard test**: subagent marker + outer interruption → no prompt.

## Open questions

- Does the Claude Agent SDK currently expose a structured field on Task tool_result for subagent max-turns? To confirm during implementation (10-minute check). If yes, prefer it over string matching; if no, ship with string matching + pinned test.
- Best location for `lastProgress` extraction: whether the streamed subagent messages are accessible on the Task tool_result payload or need to be captured separately as they stream. To investigate during implementation; if inaccessible, ship with `lastProgress: null` everywhere and fall back to option B phrasing.

## Files affected

- `apps/cli/ai/ui.ts` — detector, per-turn state, reset on turn start.
- `apps/cli/ai/output-adapter.ts` — mirror detector for the JSON adapter (so `--json` emits `max_turns_scope`).
- `apps/cli/ai/json-events.ts` — extend `TurnCompletedStatus` payload with `max_turns_scope`.
- `apps/cli/commands/ai/index.ts` — extract `maybePromptContinue`, wire the subagent branch.
- Tests co-located under `apps/cli/ai/tests/` (or existing test layout).
