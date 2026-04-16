# Slash commands require-site gating

**Date:** 2026-04-16
**Branch:** `stu-1580-slash-commands-say-done-before-site-selection`
**Status:** Approved — ready for implementation

## Problem

Invoking `/taxonomist` or `/need-for-speed` in the AI chat before selecting a site sometimes renders just a bare "Done" marker with no helpful message. Users cannot tell why nothing happened or what to do next.

### Root cause

`apps/cli/commands/ai/index.ts:545-562` dispatches slash commands as follows:

1. Commands with a `handler` run their handler (e.g., `/browser`, `/preview`, `/clear`).
2. Commands without a `handler` — currently `/taxonomist` and `/need-for-speed` — are routed to the AI agent with the prompt `"Run the /${cmd.name} skill using the Skill tool."`.

No site-presence check exists on path (2). When no site is selected:

- `runAgentTurn` (`apps/cli/commands/ai/index.ts:371-377`) skips the `[Active site: …]` prompt prefix, so the agent receives bare instructions with no site context.
- The agent invokes the `Skill` tool, reads `SKILL.md`, and — because both skills require a target site — may end the turn without emitting any visible assistant text.
- The UI's turn-completion path (`apps/cli/ai/ui.ts:2138-2146`) renders the `"Done"` marker whenever a `result` message arrives with `subtype === 'success'` and `!this.hasShownResponseMarker` — i.e., the turn ended with no user-visible response.

Behavior is non-deterministic across models and providers: sometimes the agent emits the skill's "On Startup" welcome greeting and asks which site to target (happy path); sometimes it finishes silently and the user only sees "Done" (bug).

## Goal

Make the no-site case deterministic for handlerless skill commands that require a site, without changing the happy path (skill-loading via the agent when a site is selected).

## Non-goals

- Do not modify the skill files (`plugin/skills/*/SKILL.md`) or add runtime parsing of their frontmatter.
- Do not change `runAgentTurn` or the `"Done"` rendering logic — they remain correct for their actual purpose.
- Do not modify `/browser` or `/preview` — their inline `ctx.ui.activeSite` checks stay as-is.
- Do not add new i18n strings — reuse the existing translated message.
- Do not auto-open the site picker. That is a larger UX change out of scope here.

## Design

### 1. Add `requiresSite` to `SlashCommandDef`

In `apps/cli/ai/slash-commands.ts`, extend the interface with one optional field:

```ts
export interface SlashCommandDef {
    name: string;
    description: string;
    handler?: SlashCommandHandler;
    requiresSite?: boolean;
}
```

Mark the two handlerless skill entries at the bottom of `AI_CHAT_SLASH_COMMANDS`:

```ts
{ name: 'taxonomist', description: __( 'Optimize category taxonomy with AI' ), requiresSite: true },
{ name: 'need-for-speed', description: __( 'Run a performance audit on a site' ), requiresSite: true },
```

Add a short comment above the array (or near the two entries) describing the convention: "Set `requiresSite: true` for handlerless skill commands that cannot proceed without an active site."

Handler-ful commands are unaffected — they already perform their own `ctx.ui.activeSite` checks (`/browser` at `slash-commands.ts:52-58`, `/preview` at `:234-238`).

### 2. Pre-flight check in the main loop

In `apps/cli/commands/ai/index.ts`, update the handlerless branch (currently lines 552-560) to check the flag before routing to the agent:

```ts
} else {
    if ( cmd.requiresSite && ! ui.activeSite ) {
        ui.showInfo( __( 'No site selected. Use ↓ to select a site first.' ) );
        continue;
    }
    // Skill command — no handler, route to agent
    await maybeAutoSwitchProvider();
    ui.addUserMessage( prompt );
    try {
        await runAgentTurn( `Run the /${ cmd.name } skill using the Skill tool.` );
    } catch ( error ) {
        handleAgentTurnError( error );
    }
}
```

Key points:

- Reuses the exact translated string already used by `/browser` and `/preview` (`slash-commands.ts:55` and `:236`) — consistent UX, no new i18n string.
- `ui.addUserMessage(prompt)` is intentionally skipped in the bail path. The command never ran, so the transcript stays clean.
- `continue` returns control to the input loop, matching how handler-ful commands bail.

## Files touched

- `apps/cli/ai/slash-commands.ts` — add field to interface, set flag on two entries, add convention comment.
- `apps/cli/commands/ai/index.ts` — insert pre-flight check in handlerless branch.

No other files are modified.

## Testing

Manual verification only. The existing handler-ful precedents (`/browser`, `/preview`) are not unit-tested, and this path is UI-driven.

1. `npm run cli:build && node apps/cli/dist/cli/main.mjs` — open the AI chat with no site selected.
2. Type `/taxonomist` → expect the "No site selected. Use ↓ to select a site first." info message, no agent turn, no "Done" marker.
3. Type `/need-for-speed` → same expectation.
4. Press ↓ and select a local site, then type `/taxonomist` → expect the agent to invoke the `Skill` tool and emit the skill's welcome greeting (unchanged happy path).
5. Repeat step 4 with `/need-for-speed` → expect the audit flow to proceed as before.
6. Sanity check: `/browser`, `/preview`, `/clear`, `/model`, `/provider`, `/login`, `/logout`, `/exit`, `/api-key` all behave unchanged.

Post-change quality gates (per `AGENTS.md`):

- `npx eslint --fix` on modified files.
- `npm run typecheck`.
- `npm test` if any relevant tests exist for touched files.

## Risks

- **Flag drift.** Future contributors adding a site-dependent handlerless skill command must remember to set `requiresSite: true`. Mitigated by the convention comment on the array. Acceptable; the alternative (parsing SKILL.md frontmatter at runtime) is heavier and out of scope.
- **Partial-site skills.** A future skill that works with or without a site (e.g., accepts a URL) would be too coarsely gated by a boolean. Revisit when such a skill appears; today both handlerless commands strictly require a site.

## Alternatives considered

- **Enrich the no-site prompt.** Pass an extra instruction to the agent when no site is selected, asking it to explain the skill and prompt for selection. Rejected: still non-deterministic (LLM may still finish silently), and costs a model round-trip for a known-answer case.
- **Catch empty-result turns in the UI.** Render a richer message when the turn ends with no visible text. Rejected: too broad — couples site logic to generic turn rendering and misleads users in unrelated silent-finish cases.
- **Auto-open the site picker on missing-site.** Better UX but requires new plumbing and a cancel path; out of scope.
