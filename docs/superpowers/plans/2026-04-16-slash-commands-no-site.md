# Slash Commands No-Site Gating Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show a helpful message instead of a bare "Done" when users invoke a handlerless skill slash command (`/taxonomist`, `/need-for-speed`) in the AI chat with no active site.

**Architecture:** Add an optional `requiresSite` boolean to the `SlashCommandDef` interface. Flag the two handlerless skill entries. In the main input loop, check the flag before routing to the agent; if no site is active, print the existing "No site selected…" info line and return control to the loop — mirroring how `/browser` and `/preview` already bail.

**Tech Stack:** TypeScript, `@wordpress/i18n` (`__`), Studio CLI (yargs/commander-style command loop), Claude Agent SDK.

**Spec:** `docs/superpowers/specs/2026-04-16-slash-commands-no-site-design.md`

---

## File Structure

Two files are modified. No new files.

- **`apps/cli/ai/slash-commands.ts`** — owns the `SlashCommandDef` interface and the `AI_CHAT_SLASH_COMMANDS` array (command metadata + optional handlers). Adding a small metadata field belongs here.
- **`apps/cli/commands/ai/index.ts`** — owns the interactive main loop that dispatches slash commands. The pre-flight check belongs in the handlerless branch (lines 552-561).

No tests are added. The existing handler-ful precedents (`/browser`, `/preview`) are not unit-tested, this path is UI-driven, and the Claude Agent SDK is hard to mock here. Verification is manual via the built CLI.

---

### Task 1: Extend `SlashCommandDef` and flag the two handlerless skill entries

**Files:**
- Modify: `apps/cli/ai/slash-commands.ts:35-39` (interface), `apps/cli/ai/slash-commands.ts:296-297` (entries)

- [ ] **Step 1: Add `requiresSite` to the `SlashCommandDef` interface**

Open `apps/cli/ai/slash-commands.ts`. Replace the interface at lines 35-39:

```ts
export interface SlashCommandDef {
	name: string;
	description: string;
	handler?: SlashCommandHandler;
}
```

with:

```ts
export interface SlashCommandDef {
	name: string;
	description: string;
	handler?: SlashCommandHandler;
	// Set `true` for handlerless skill commands that cannot proceed without an
	// active site. The main loop shows a "No site selected…" message and skips
	// the agent turn when no site is active.
	requiresSite?: boolean;
}
```

- [ ] **Step 2: Flag `/taxonomist` and `/need-for-speed` as requiring a site**

In the same file, replace lines 296-297:

```ts
	{ name: 'taxonomist', description: __( 'Optimize category taxonomy with AI' ) },
	{ name: 'need-for-speed', description: __( 'Run a performance audit on a site' ) },
```

with:

```ts
	{
		name: 'taxonomist',
		description: __( 'Optimize category taxonomy with AI' ),
		requiresSite: true,
	},
	{
		name: 'need-for-speed',
		description: __( 'Run a performance audit on a site' ),
		requiresSite: true,
	},
```

- [ ] **Step 3: Run the type checker to confirm the interface change is clean**

Run: `npm run typecheck`
Expected: Exits 0 with no errors. (The new optional field is backward-compatible with all existing command entries.)

---

### Task 2: Add the pre-flight site check in the main loop

**Files:**
- Modify: `apps/cli/commands/ai/index.ts:552-561`

- [ ] **Step 1: Insert the `requiresSite` check before the agent turn**

Open `apps/cli/commands/ai/index.ts`. Replace the handlerless branch at lines 552-561:

```ts
				} else {
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

with:

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

Notes:
- The string `'No site selected. Use ↓ to select a site first.'` is reused verbatim from `apps/cli/ai/slash-commands.ts:55` and `:236` (existing `/browser` and `/preview` handlers). No new i18n string — same translation applies.
- `ui.addUserMessage(prompt)` is intentionally skipped on the bail path so an unrun command does not land in the transcript.
- `continue` returns control to the outer `while ( true )` input loop, matching the pattern used by handler-ful commands.

- [ ] **Step 2: Run the type checker**

Run: `npm run typecheck`
Expected: Exits 0 with no errors. (`ui.activeSite` already exists on `AiChatUI` — used by `/browser` and `/preview` — and `cmd.requiresSite` is the flag added in Task 1.)

- [ ] **Step 3: Lint-format the two modified files**

Run:

```bash
npx eslint --fix apps/cli/ai/slash-commands.ts apps/cli/commands/ai/index.ts
```

Expected: Exits 0. No remaining lint errors.

---

### Task 3: Manual verification and commit

**Files:** (none modified — verification only)

- [ ] **Step 1: Build the CLI**

Run from the repo root:

```bash
npm run cli:build
```

Expected: Exits 0. Produces `apps/cli/dist/cli/main.mjs`.

- [ ] **Step 2: Launch the AI chat**

Run:

```bash
node apps/cli/dist/cli/main.mjs
```

Expected: The interactive AI chat opens. No site should be auto-selected (the status line should not show a site name). If a site is auto-selected, use the site picker to deselect — or simply restart with no prior session.

- [ ] **Step 3: Verify `/taxonomist` with no site**

At the prompt, type `/taxonomist` and press Enter.
Expected:
- An info message appears: `No site selected. Use ↓ to select a site first.`
- No assistant turn is started (no thinking spinner).
- No "Done" marker is rendered.
- Control returns to the prompt immediately.

- [ ] **Step 4: Verify `/need-for-speed` with no site**

Type `/need-for-speed` and press Enter.
Expected: Same as Step 3 — the same info message, no agent turn, no "Done" marker.

- [ ] **Step 5: Verify the happy path is unchanged**

Press ↓ to open the site picker. Select a local Studio site. Then type `/taxonomist` and press Enter.
Expected: The agent invokes the `Skill` tool and emits the Taxonomist welcome message (the text from the "On Startup" section of `apps/cli/ai/plugin/skills/taxonomist/SKILL.md`), then proceeds with the skill flow. **This should match behavior prior to the change.**

Repeat with `/need-for-speed`. Expected: audit flow proceeds as before.

- [ ] **Step 6: Sanity-check the unaffected commands**

Still in the AI chat, verify each of the following still works as before:

- `/clear` — clears the transcript.
- `/browser` (with no site) — shows the same "No site selected…" info (unchanged).
- `/preview` (with no site) — shows the same "No site selected…" info (unchanged).
- `/model` — opens the model picker.
- `/provider` — opens the provider picker.
- `/exit` — exits the chat.

Expected: All commands behave exactly as before. None of them are affected by the `requiresSite` flag (they have explicit handlers).

- [ ] **Step 7: Commit**

Run from the repo root:

```bash
git add apps/cli/ai/slash-commands.ts apps/cli/commands/ai/index.ts
git commit -m "Gate handlerless skill commands on active site"
```

Expected: Exits 0. Commit lands on branch `stu-1580-slash-commands-say-done-before-site-selection`.

---

## Self-Review Notes

- **Spec coverage:** Interface change (Task 1 Step 1), flag on both entries (Task 1 Step 2), pre-flight check (Task 2 Step 1), manual verification across happy path / bail path / unaffected commands (Task 3 Steps 3-6), quality gates (Task 1 Step 3, Task 2 Steps 2-3), commit (Task 3 Step 7). Non-goals from the spec (no SKILL.md changes, no `runAgentTurn` changes, no new i18n, no picker auto-open) are all respected.
- **Placeholder scan:** All code blocks contain complete content. No TBDs, no "add error handling" stubs, no "similar to Task N" references.
- **Type consistency:** `requiresSite?: boolean` on the interface matches `cmd.requiresSite` in the main loop. `ui.activeSite` and `ui.showInfo` are already used elsewhere in both files. The bail-path string is literally identical (byte-for-byte) to the existing uses at `slash-commands.ts:55` and `:236`, which ensures `@wordpress/i18n` reuses the same translation entry.
