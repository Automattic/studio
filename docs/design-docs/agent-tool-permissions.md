# Studio Code Agent: Tool Permission Layer

**Status:** Draft spec / exploration
**Motivating incident:** A user asked the agent to undo a CSS change. The agent decided "undo" meant deleting the entire site — `site_delete` executed immediately, moved the site folder to trash, and permanently deleted its WordPress.com preview sites. Nothing in the stack required, or even suggested, asking first.

## Why

The Studio Code agent auto-executes every tool call. There is no approval step anywhere: not in the model's instructions (the system prompt describes `site_delete` neutrally), not in the tool layer (`apps/cli/ai/tools/delete-site.ts` runs the delete command directly), and not in the agent framework (pi's tools run as soon as the model calls them). Several tools are destructive or outright irreversible:

| Tool | Consequence |
| --- | --- |
| `site_delete` | Site removed from Studio; files trashed; **preview sites permanently deleted**; SSL certs and hosts entries removed |
| `preview_delete` | Hosted preview site permanently deleted |
| `site_push` | Overwrites a live WordPress.com site with local content |
| `site_pull` | Overwrites the local site with remote content |
| `site_import` | Overwrites the local site's database/files from a backup |
| `wp_cli` | Arbitrary WP-CLI, including `db reset`, `site empty`, bulk deletes |
| `Bash` / `Write` / `Edit` | Arbitrary shell / file overwrites within `~/Studio` |

A permission layer must be **enforced in code, inside tool execution** — not delegated to the model. Prompt guidance ("always ask before deleting") and self-reported parameters (`confirmed: true`) are both things a model can skip or hallucinate; this incident *was* a model-judgment failure.

## Goals

- The agent cannot execute a gated tool without an explicit user decision, in every interactive surface: CLI terminal, old desktop UI (`apps/studio`), new UI (`apps/ui`, both Electron/IPC and hosted/SSE).
- Non-interactive contexts (eval runner, standalone `--json`, MCP) **fail closed**: a gated tool is blocked with an explanatory error instead of running.
- Users can reduce friction per tool ("Always allow") without editing config files.
- A declined tool call is a normal conversational event — the agent acknowledges and continues, it doesn't error out or retry.

## Non-goals (v1)

- Gating `Write`/`Edit`/`Bash`. The workhorse file tools would make prompting unbearable; the real protection for overwritten files is checkpointing (separate effort). Bash is bounded to `~/Studio` already.
- Per-site or per-session permission scopes (future).
- Argument-level diff previews ("this push will change 14 files") — the request card shows tool arguments, not computed diffs.

---

## How the agent runs today (context)

One CLI process runs the agent loop for every surface; the surfaces differ only in how they render and answer:

- **CLI terminal** (`studio code`): `AiChatUI` renders in-terminal; `askUser` already blocks the loop on a `SelectList` promise (`apps/cli/ai/ui.ts:1907`).
- **Desktop (both UIs)**: the main process forks the CLI with `--json` (`packages/common/ai/run-manager.ts:176`). Events flow child → parent over Node IPC as `JsonEvent`s (`packages/common/ai/json-events.ts`) and fan out to renderers on the `ai-agent-event` channel. Answers flow back via `child.send({ type: 'answer', answers })` (`run-manager.ts:301`), fed by the `answerAiAgentQuestion` IPC handler.
- **New UI connectors**: `apps/ui` talks through a `Connector` interface — `ipc` (Electron) and `hosted` (HTTP + SSE, `POST /runs/{runId}/answer`) — both already round-trip `question.asked` events (`apps/ui/src/data/core/connectors/`).
- **Remote session (Telegram)**: `turn-runner.ts` treats `question.asked` as a paused turn and resumes with the pre-supplied `--permission-response` CLI flag (the flag already exists: `apps/cli/commands/ai/index.ts:739`).
- **Headless** (eval runner, standalone `--json` with no parent): no `onAskUser`; the question tool isn't even registered.

Two existing mechanisms make this spec mostly plumbing rather than invention:

1. **pi's extension API can veto tool calls.** Extensions registered via `extensionFactories` (already used by `createResponseLengthExtension`) can subscribe to `tool_call`, which fires *before* a tool executes. The handler may be async — it can block indefinitely — and returning `{ block: true, reason }` cancels execution; pi emits an error tool result carrying `reason` back to the model. This is the enforcement point.
2. **The AskUserQuestion round-trip already blocks a turn on user input** in every interactive surface, with persistence (`studio.agent_question` entries) and resume semantics. The permission flow mirrors it with its own event type.

---

## Design

### 1. Policy model

Every agent tool gets a permission classification. Two levels in v1:

- **`allow`** — runs immediately (default for everything not listed below).
- **`ask`** — requires a user decision before each execution.

Default `ask` tools: `site_delete`, `preview_delete`, `site_push`, `site_pull`, `site_import`, plus `wp_cli` **only when the command matches a destructive pattern** (see below).

The effective policy for a tool resolves in order:

1. **Session grant** — the user chose "Always allow" earlier in this session (in-memory, per-run process).
2. **User preference** — `toolPermissions` in `~/.studio/shared.json` (see Storage).
3. **Built-in default** — the classification table shipped in code.

`deny` is not a stored policy level; declining happens per-request. (A stored "never" level is cheap to add later if wanted.)

#### wp_cli classifier

Gating every `wp_cli` call would be unusable — it's the agent's workhorse. Instead a small pattern classifier escalates only clearly destructive commands to `ask`:

```
db (reset|drop|clean|import|query)   site empty        plugin (delete|uninstall)
theme delete                          post delete       comment delete
user delete                           option delete     ...
```

The classifier lives beside the tool (`apps/cli/ai/tools/wp-cli.ts`) and is unit-tested. It must parse past global flags (`wp --path=… db reset`) and refuse to classify compound shell constructs (`&&`, `;`, `|`, `$( )`) as safe — anything it can't confidently classify as safe escalates to `ask`. False positives are acceptable; false negatives are not.

#### Tool metadata

Add an optional field to Studio tool definitions (`apps/cli/ai/tools/define-tool.ts`):

```ts
permission?: {
	level: 'allow' | 'ask';
	// Human-readable action summary shown in the confirmation.
	// Receives validated args; returns title + consequence lines.
	describe?: ( args ) => PermissionRequestDescription;
	// Optional per-call escalation (wp_cli classifier hooks in here).
	classify?: ( args ) => 'allow' | 'ask';
}
```

`describe` is what makes the confirmation meaningful. For `site_delete` it resolves the site and reports the blast radius:

> **Delete site "Sunset Bakery"?**
> Files move to the system trash. **2 preview sites will be permanently deleted** — this cannot be undone. SSL certificates and hosts entries are removed.

### 2. Enforcement: a pi extension

A new inline extension, `createToolPermissionExtension`, registered in `extensionFactories` next to the response-length extension (`apps/cli/ai/runtimes/pi/index.ts:295`):

```ts
pi.on( 'tool_call', async ( event ) => {
	const verdict = resolvePolicy( event.toolName, event.input ); // session grant → user pref → default (+classify)
	if ( verdict === 'allow' ) {
		return;
	}
	if ( ! onRequestPermission ) {
		// Headless / non-interactive: fail closed.
		return {
			block: true,
			reason:
				`${ event.toolName } requires interactive user confirmation, which is not available ` +
				`in this environment. Do not retry. Tell the user what you wanted to do and why.`,
		};
	}
	const decision = await onRequestPermission( buildRequest( event ) ); // blocks the turn
	if ( decision === 'always_allow' ) {
		grantForSession( event.toolName );
		await persistUserPreference( event.toolName, 'allow' ); // lockSharedConfig()
		return;
	}
	if ( decision === 'allow_once' ) {
		return;
	}
	return {
		block: true,
		reason:
			`The user declined permission to run ${ event.toolName }. Do not retry or work around this. ` +
			`Acknowledge the decision and ask what they would like to do instead.`,
	};
} );
```

Key properties:

- **In-process, model-proof.** The model never sees a path where a gated tool runs without a decision. Blocking produces an ordinary error tool result, so the loop continues gracefully.
- **Fail closed everywhere.** Death, interrupt, or a missing channel while a request is pending means the tool *never ran*.
- **`onRequestPermission` is a host callback** threaded through `StudioAgentTurnConfig`, exactly like `onAskUser`. Each surface implements it once.
- The interrupt path (Esc / Stop button / abort signal) resolves any pending request as **deny**.

The block `reason` doubles as the model-facing contract; a short **Permissions** section is also added to the system prompt (`apps/cli/ai/system-prompt.ts`): some tools require user approval; a blocked result means the user declined — don't retry; and explicitly: *"undo" means reverting the specific change; it never means deleting a site.* The prompt layer isn't enforcement, but it keeps the model from proposing deletions in the first place.

### 3. Wire protocol

Permission requests are a first-class event, deliberately *not* reusing `question.asked` — the UIs need to render them differently (warning styling, fixed options, deny-on-dismiss) and the answers must not persist as `studio.user_prompt` chat entries.

New `JsonEvent` variant (`packages/common/ai/json-events.ts`):

```ts
{
	type: 'permission.requested';
	timestamp: string;
	request: {
		id: string;             // unique per request
		toolCallId: string;
		toolName: string;
		title: string;          // "Delete site "Sunset Bakery"?"
		consequences: string[]; // pre-localized lines from describe()
		params: Record< string, unknown >; // raw args, for expandable detail
	};
}
```

Response path, per surface:

| Surface | Transport |
| --- | --- |
| CLI terminal | in-process promise (no wire) |
| Desktop main ⇄ CLI child | `child.send( { type: 'permission_response', id, decision } )` — alongside the existing `{ type: 'answer' }` message (`run-manager.ts:301`) |
| Renderer ⇄ main | new IPC `answerAiAgentPermission( runId, id, decision )` (handler in `apps/studio/src/ipc-handlers.ts`, exposed via preload) |
| New UI connector | `Connector.answerAgentPermission( runId, id, decision )` — IPC connector calls the IPC above; hosted connector `POST /runs/{runId}/permission` |
| Remote session | `turn-runner.ts` treats `permission.requested` like paused questions; resume passes the decision via the existing `--permission-response` flag |

`decision` is `'allow_once' | 'always_allow' | 'deny'`.

`JsonAdapter` (`apps/cli/ai/output-adapter.ts`) gets a `requestPermission()` sibling to `askUser()`: emit the event; if forked (`process.send`), await the `permission_response` IPC message; otherwise emit `turn.completed` with status `paused` and halt — same fallback shape as questions, and still fail-closed because the tool hasn't run.

### 4. Session persistence

Two new custom entry types (registered with the existing `studio.*` entries in `packages/common/ai/sessions/entry-types.ts`):

- `studio.permission_request` — appended *before* the user is asked: `{ id, toolCallId, toolName, title, consequences }`.
- `studio.permission_response` — appended after: `{ id, decision }`.

Replay (`apps/cli/ai/sessions/replay.ts`, plus both UIs' entry renderers) pairs them by `id`: answered requests render as a collapsed "✓ Allowed / ✕ Denied — Delete site …" row; a request with no paired response renders as *expired* (never as re-answerable — the process that was waiting is gone, and the tool did not run). This mirrors how `studio.agent_question` + `studio.user_prompt(source:'ask_user')` pair today.

### 5. UX per surface

The confirmation is one consistent card everywhere: title, consequence lines, three actions —
**Allow once** (primary) · **Always allow for this tool** (secondary, labeled with the tool's plain-English name) · **Deny** (tertiary). Dismissal (Esc, interrupt, app quit) = deny.

- **CLI terminal** (`apps/cli/ai/ui.ts`): reuse the `SelectList` machinery from `askUser`, framed with a warning glyph/border to distinguish from ordinary questions. Esc cancels → deny (note: `askUser`'s Esc currently resolves an empty answer; the permission path must map that to an explicit deny).
- **Old UI** (`apps/studio/src/components/studio-code-session/conversation/`): a `PermissionRequest` card next to `AgentQuestion`, rendered from `studio.permission_request` entries + a live `pendingPermissions` state in `use-agent-run.tsx` (same shape as `pendingQuestions`, fed by the `permission.requested` case). Composer blocking reuses the existing gate: `composerBusy = hasActiveRun || pendingQuestions.length > 0 || pendingPermissions.length > 0`. Colors via `--color-frame-*` tokens only (e.g. `--color-frame-error` accent); verify light + dark.
- **New UI** (`apps/ui/src/ui-classic/components/session-view/conversation/`): same card, WPDS-styled (`--wpds-color-*`); `pendingPermissions` added to the per-session external store in `apps/ui/src/data/queries/use-agent-run.tsx`, dispatched like `questions_added`/`batch_dispatched`. Works identically over the hosted connector since it rides the same SSE event stream.
- **Notifications**: a pending permission should trigger the existing "agent needs input" notification path for unviewed chats, same as questions.

### 6. Settings

"Always allow" choices persist in `~/.studio/shared.json` under a new `toolPermissions` key (schema in `packages/common/lib/shared-config.ts`, all writes via `lockSharedConfig()`/`unlockSharedConfig()`):

```jsonc
{ "toolPermissions": { "site_push": "allow" } }
```

Shared config is the right home because the CLI agent process is the enforcement point and already reads it, in every mode — terminal, desktop child, remote daemon.

Management surfaces:

- **CLI**: a `/permissions` slash command (pattern in `apps/cli/ai/slash-commands.ts`) — list gated tools with current policy, toggle via the same select UI.
- **Old UI**: a section in the user-settings General tab (`apps/studio/src/modules/user-settings/components/preferences-tab.tsx`).
- **New UI**: a block in settings-view preferences (`apps/ui/src/components/settings-view/`); the hosted connector currently doesn't persist preferences — acceptable v1 gap, "Always allow" still works per-session there.

Settings can only relax `ask` → `allow` for the listed tools; nothing outside the gated set is configurable in v1 (keeps the surface small and honest).

### 7. MCP server

`apps/cli/ai/mcp-server.ts` dispatches `rawHandler` directly and has no user channel. v1: annotate gated tools with MCP's `destructiveHint`/`readOnlyHint` tool annotations so conforming clients (Claude Code, Claude Desktop) apply their own approval UX. The extension doesn't wrap the MCP path — but since MCP clients bring their own permission prompts, this is defense-in-depth rather than a hole. If we ever ship an MCP mode without a prompting client, gated tools there should be excluded or require an explicit opt-in flag.

---

## Edge cases

- **Process death / app quit while pending** — the tool never ran (fail closed). On resume the request renders as expired; the model's turn ended without the tool result and it will re-attempt or ask.
- **Interrupt (Esc / Stop)** — pending request resolves as deny; turn winds down normally via the existing interrupt path.
- **Parallel tool calls** — pi can issue several calls in one turn. Requests queue in arrival order; each blocks independently in its own `tool_call` handler. UIs render them like a question batch (answer one at a time).
- **"Always allow" race** — persisting to shared.json uses the lock helpers; the in-memory session grant applies immediately so the current turn doesn't re-read the file.
- **Answer for an unknown/stale `id`** — ignored (same as the question flow's tolerance for duplicate answers).
- **Model retries after deny** — the block reason instructs it not to; if it does retry, the gate simply fires again. Enforcement doesn't depend on model compliance.

## Rollout

1. **Enforcement core** (protection ships here): tool metadata + policy resolver + wp_cli classifier + permission extension + CLI terminal UI + fail-closed headless behavior + system-prompt section. The desktop, before its UI exists, gets the fail-closed block rather than silent deletion — a deliberate, temporary regression in capability, not safety.
2. **Desktop wiring**: `permission.requested` JsonEvent, run-manager response routing, IPC handler + preload, old-UI card + composer gating, new-UI store/connectors/card, remote-session pause/resume.
3. **Preferences**: shared-config schema + "Always allow" persistence + `/permissions` command + both settings surfaces.
4. **Follow-ups**: MCP annotations, Bash/Write/Edit strategy (checkpointing is the better fix), per-site scopes, hosted preference persistence.

## Decisions (formerly open questions)

1. **`site_delete` always asks.** It never honors "Always allow" — the confirmation card for `site_delete` offers only *Allow once* and *Deny*, and a stored `toolPermissions` entry for it is ignored.
2. **`site_push` keeps the single `ask` default, but the confirmation must name the target** — site name, URL, and environment (production/staging) — in the describe() copy.
3. **The agent's `site_delete` keeps files by default.** The tool's `deleteFiles` default flips to `false`; the agent only passes `true` when the user explicitly asked for the files to be trashed, and the confirmation copy states which will happen.
