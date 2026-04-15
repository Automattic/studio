# Agent SDK Subagent Max-Turns Continue Prompt — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a Task-spawned subagent hits its max-turn cap, detect it during the outer turn and, after the turn finishes, show the same "Continue?" prompt the top-level `error_max_turns` path already shows — pre-populated with the subagent's last visible progress when available.

**Architecture:** Add a per-turn detector in `apps/cli/ai/ui.ts` that watches tool results for a subagent max-turns marker. Extract the existing inline continue prompt in `apps/cli/commands/ai/index.ts` into a shared helper. After the outer stream ends, call the helper with either the outer `max_turns` result or the subagent flag (outer wins, never both). JSON mode mirrors the detection and extends the `turn.completed` payload with a `max_turns_scope` field.

**Tech Stack:** TypeScript, Vitest, `@anthropic-ai/claude-agent-sdk`, `@wordpress/i18n`.

**Spec:** `docs/superpowers/specs/2026-04-15-agent-sdk-subagent-max-turns-continue-prompt.md`

---

## File Structure

- **Create:** `apps/cli/ai/subagent-max-turns.ts` — marker constant + pure `detectSubagentMaxTurns` function. Isolating the detector keeps the SDK-coupled string in one place and makes it trivially unit-testable.
- **Create:** `apps/cli/ai/tests/subagent-max-turns.test.ts` — detector unit tests.
- **Modify:** `apps/cli/ai/ui.ts` — add `subagentMaxTurns` state, reset in `beginAgentTurn`, set from `handleMessage` when a Task tool_result matches the detector.
- **Modify:** `apps/cli/ai/output-adapter.ts` — extend `AiOutputAdapter` interface with `subagentMaxTurns` accessor; implement in `JsonAdapter` (also tracked via `handleMessage`).
- **Modify:** `apps/cli/ai/json-events.ts` — add optional `maxTurnsScope: 'outer' | 'subagent'` to the `turn.completed` event payload.
- **Modify:** `apps/cli/commands/ai/index.ts` — extract `maybePromptContinue` helper; wire the subagent branch; pass scope into JSON `emitTurnCompleted` callsite.
- **Modify:** `apps/cli/ai/tests/ui.test.ts` — add detector-integration tests for `handleMessage`.

---

## Task 1: Detector module — marker constant + pure function

**Files:**
- Create: `apps/cli/ai/subagent-max-turns.ts`
- Test: `apps/cli/ai/tests/subagent-max-turns.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/cli/ai/tests/subagent-max-turns.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { detectSubagentMaxTurns, SUBAGENT_MAX_TURNS_MARKER } from 'cli/ai/subagent-max-turns';

describe( 'SUBAGENT_MAX_TURNS_MARKER', () => {
	it( 'pins the exact SDK error substring we key on', () => {
		// If this test fails after an SDK bump, inspect the new error string
		// and update the marker + any matching tests intentionally.
		expect( SUBAGENT_MAX_TURNS_MARKER ).toBe( 'Reached maximum number of turns' );
	} );
} );

describe( 'detectSubagentMaxTurns', () => {
	it( 'returns null when content does not contain the marker', () => {
		expect( detectSubagentMaxTurns( 'Site "aura" stopped.' ) ).toBeNull();
		expect( detectSubagentMaxTurns( '' ) ).toBeNull();
		expect( detectSubagentMaxTurns( null ) ).toBeNull();
		expect( detectSubagentMaxTurns( undefined ) ).toBeNull();
	} );

	it( 'detects the marker in a plain string', () => {
		const input = 'Claude Code returned an error result: Reached maximum number of turns (50)';
		expect( detectSubagentMaxTurns( input ) ).toEqual( { lastProgress: null } );
	} );

	it( 'detects the marker inside an array of content blocks', () => {
		const input = [
			{ type: 'text', text: 'Previous step: created product 21.' },
			{ type: 'text', text: 'Claude Code returned an error result: Reached maximum number of turns (50)' },
		];
		expect( detectSubagentMaxTurns( input ) ).toEqual( {
			lastProgress: 'Previous step: created product 21.',
		} );
	} );

	it( 'truncates long progress to 200 characters', () => {
		const long = 'x'.repeat( 500 );
		const input = [
			{ type: 'text', text: long },
			{ type: 'text', text: 'Reached maximum number of turns (50)' },
		];
		const result = detectSubagentMaxTurns( input );
		expect( result?.lastProgress ).toHaveLength( 200 );
	} );

	it( 'ignores non-text blocks when extracting progress', () => {
		const input = [
			{ type: 'tool_use', name: 'Bash' },
			{ type: 'text', text: 'Created variation 3 of 5.' },
			{ type: 'text', text: 'Reached maximum number of turns (50)' },
		];
		expect( detectSubagentMaxTurns( input )?.lastProgress ).toBe( 'Created variation 3 of 5.' );
	} );
} );
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- apps/cli/ai/tests/subagent-max-turns.test.ts`
Expected: FAIL — module `cli/ai/subagent-max-turns` does not exist.

- [ ] **Step 3: Implement the detector**

Create `apps/cli/ai/subagent-max-turns.ts`:

```ts
/**
 * Literal substring emitted by the Claude Agent SDK when a Task-spawned
 * subagent hits its own max-turn cap. Pinning it as a constant (with a
 * test) makes a future SDK wording change break loudly rather than silently
 * disable the continue prompt.
 */
export const SUBAGENT_MAX_TURNS_MARKER = 'Reached maximum number of turns';

const MAX_PROGRESS_CHARS = 200;

type ContentBlock = { type: string; text?: string } | Record< string, unknown >;

/**
 * Inspect a tool_result payload for evidence that a subagent ran out of turns.
 * Returns `{ lastProgress }` if detected (progress may be null if the payload
 * contains no preceding assistant text), or null otherwise.
 */
export function detectSubagentMaxTurns(
	content: string | ContentBlock[] | null | undefined
): { lastProgress: string | null } | null {
	if ( content == null ) {
		return null;
	}

	if ( typeof content === 'string' ) {
		return content.includes( SUBAGENT_MAX_TURNS_MARKER ) ? { lastProgress: null } : null;
	}

	if ( ! Array.isArray( content ) ) {
		return null;
	}

	const texts = content
		.filter(
			( block ): block is { type: 'text'; text: string } =>
				typeof block === 'object' &&
				block !== null &&
				( block as { type?: string } ).type === 'text' &&
				typeof ( block as { text?: unknown } ).text === 'string'
		)
		.map( ( block ) => block.text );

	const hasMarker = texts.some( ( text ) => text.includes( SUBAGENT_MAX_TURNS_MARKER ) );
	if ( ! hasMarker ) {
		return null;
	}

	const priorText = [ ...texts ]
		.reverse()
		.find( ( text ) => ! text.includes( SUBAGENT_MAX_TURNS_MARKER ) );

	const lastProgress = priorText
		? priorText.slice( 0, MAX_PROGRESS_CHARS )
		: null;

	return { lastProgress };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- apps/cli/ai/tests/subagent-max-turns.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Lint + typecheck**

Run: `npx eslint --fix apps/cli/ai/subagent-max-turns.ts apps/cli/ai/tests/subagent-max-turns.test.ts && npm run typecheck`
Expected: No errors.

- [ ] **Step 6: Commit**

```bash
git add apps/cli/ai/subagent-max-turns.ts apps/cli/ai/tests/subagent-max-turns.test.ts
git commit -m "Add subagent max-turns detector"
```

---

## Task 2: Wire detector into AiChatUI state

**Files:**
- Modify: `apps/cli/ai/ui.ts`
- Test: `apps/cli/ai/tests/ui.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `apps/cli/ai/tests/ui.test.ts` inside the existing `describe( 'AiChatUI.handleMessage', ... )` block (or add a new describe if cleaner):

```ts
describe( 'AiChatUI subagent max-turns detection', () => {
	beforeEach( () => {
		vi.clearAllMocks();
	} );

	function createMinimalUi() {
		const ui = Object.create( AiChatUI.prototype ) as {
			handleMessage: ( message: unknown ) => unknown;
			subagentMaxTurns: { lastProgress: string | null } | null;
			[ key: string ]: unknown;
		};
		ui.pendingToolCalls = new Map( [
			[ 'task-1', { name: 'Task', input: { description: 'setup products' } } ],
		] );
		ui.pendingTodoRenders = new Map();
		ui.pendingTodoRenderOrder = [];
		ui.showTodoToolResult = vi.fn();
		ui.showToolResult = vi.fn();
		ui.currentMarkdown = null;
		ui.currentResponseText = '';
		ui.subagentMaxTurns = null;
		return ui;
	}

	it( 'sets subagentMaxTurns when a Task tool_result contains the marker', () => {
		const ui = createMinimalUi();

		ui.handleMessage( {
			type: 'user',
			parent_tool_use_id: 'task-1',
			tool_use_result: {
				content: [
					{ type: 'text', text: 'Updated product 21.' },
					{
						type: 'text',
						text: 'Claude Code returned an error result: Reached maximum number of turns (50)',
					},
				],
			},
			message: { content: [] },
		} );

		expect( ui.subagentMaxTurns ).toEqual( { lastProgress: 'Updated product 21.' } );
	} );

	it( 'leaves subagentMaxTurns null when the marker is absent', () => {
		const ui = createMinimalUi();

		ui.handleMessage( {
			type: 'user',
			parent_tool_use_id: 'task-1',
			tool_use_result: { content: 'Task completed successfully.' },
			message: { content: [] },
		} );

		expect( ui.subagentMaxTurns ).toBeNull();
	} );

	it( 'overwrites with the most recent subagent max-turns event', () => {
		const ui = createMinimalUi();
		ui.subagentMaxTurns = { lastProgress: 'older progress' };
		ui.pendingToolCalls.set( 'task-2', { name: 'Task', input: {} } );

		ui.handleMessage( {
			type: 'user',
			parent_tool_use_id: 'task-2',
			tool_use_result: {
				content: [
					{ type: 'text', text: 'newer progress' },
					{ type: 'text', text: 'Reached maximum number of turns (50)' },
				],
			},
			message: { content: [] },
		} );

		expect( ui.subagentMaxTurns ).toEqual( { lastProgress: 'newer progress' } );
	} );
} );
```

Add the `AiChatUI` import already exists at the top of the file.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- apps/cli/ai/tests/ui.test.ts`
Expected: FAIL — `ui.subagentMaxTurns` is undefined / never set.

- [ ] **Step 3: Add state field and reset**

In `apps/cli/ai/ui.ts`, near line 448 (where `private wasInterrupted = false;` lives), add:

```ts
subagentMaxTurns: { lastProgress: string | null } | null = null;
```

(Public field so `commands/ai/index.ts` can read it via the adapter interface.)

In `beginAgentTurn()` (starts at line 1415), after `this.wasInterrupted = false;`, add:

```ts
this.subagentMaxTurns = null;
```

- [ ] **Step 4: Detect in `handleMessage`**

Add the import at the top of `apps/cli/ai/ui.ts`:

```ts
import { detectSubagentMaxTurns } from 'cli/ai/subagent-max-turns';
```

Inside `handleMessage`, in the `case 'user':` branch (starts line 2116), right after the existing `const toolCall = toolCallId ? this.pendingToolCalls.get( toolCallId ) : null;` and BEFORE the `if ( toolCallId )` deletion — add:

```ts
if ( toolCall?.name === 'Task' ) {
	const toolResult = ( message as { tool_use_result?: { content?: unknown } } )
		.tool_use_result;
	const rawContent = toolResult?.content as
		| string
		| Array< Record< string, unknown > >
		| null
		| undefined;
	const detected = detectSubagentMaxTurns( rawContent );
	if ( detected ) {
		this.subagentMaxTurns = detected;
	}
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- apps/cli/ai/tests/ui.test.ts`
Expected: PASS on the three new cases plus the existing ones.

- [ ] **Step 6: Lint + typecheck**

Run: `npx eslint --fix apps/cli/ai/ui.ts apps/cli/ai/tests/ui.test.ts && npm run typecheck`
Expected: No errors.

- [ ] **Step 7: Commit**

```bash
git add apps/cli/ai/ui.ts apps/cli/ai/tests/ui.test.ts
git commit -m "Detect subagent max-turns in AiChatUI.handleMessage"
```

---

## Task 3: Expose subagentMaxTurns on the adapter interface + JsonAdapter

**Files:**
- Modify: `apps/cli/ai/output-adapter.ts`

- [ ] **Step 1: Add field to interface**

In `apps/cli/ai/output-adapter.ts`, inside the `AiOutputAdapter` interface (starts line 11), after `onInterrupt`, add:

```ts
subagentMaxTurns: { lastProgress: string | null } | null;
```

This compiles against `AiChatUI` because Task 2 added the matching public field.

- [ ] **Step 2: Implement in JsonAdapter**

In the `JsonAdapter` class (starts line 42), after `onInterrupt: ...` (line 47), add:

```ts
subagentMaxTurns: { lastProgress: string | null } | null = null;
```

Import the detector at the top of the file:

```ts
import { detectSubagentMaxTurns } from 'cli/ai/subagent-max-turns';
```

Extend `JsonAdapter.handleMessage` (line 112) to also detect subagent max-turns. Replace the method body with:

```ts
handleMessage( message: SDKMessage ): HandleMessageResult | undefined {
	emitEvent( { type: 'message', timestamp: new Date().toISOString(), message } );

	if ( message.type === 'user' ) {
		const typed = message as unknown as {
			tool_use_result?: { content?: unknown };
		};
		const detected = detectSubagentMaxTurns(
			typed.tool_use_result?.content as
				| string
				| Array< Record< string, unknown > >
				| null
				| undefined
		);
		if ( detected ) {
			this.subagentMaxTurns = detected;
		}
	}

	if ( message.type === 'result' ) {
		this.sessionId = message.session_id;
		if ( message.subtype === 'error_max_turns' ) {
			return {
				type: 'max_turns',
				sessionId: message.session_id,
				numTurns: message.num_turns,
				costUsd: message.total_cost_usd,
			};
		}
		return {
			type: 'result',
			sessionId: message.session_id,
			success: message.subtype === 'success',
		};
	}

	return undefined;
}
```

Also reset the flag when a new outer turn begins. Modify `beginAgentTurn` (line 100):

```ts
beginAgentTurn(): void {
	this.subagentMaxTurns = null;
	emitEvent( { type: 'turn.started', timestamp: new Date().toISOString() } );
}
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: No errors. The interface change forces both adapters to implement the new field.

- [ ] **Step 4: Lint**

Run: `npx eslint --fix apps/cli/ai/output-adapter.ts`
Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add apps/cli/ai/output-adapter.ts
git commit -m "Expose subagentMaxTurns on AiOutputAdapter and JsonAdapter"
```

---

## Task 4: Extend JSON `turn.completed` event with `maxTurnsScope`

**Files:**
- Modify: `apps/cli/ai/json-events.ts`

- [ ] **Step 1: Extend the `turn.completed` variant**

In `apps/cli/ai/json-events.ts`, modify the `turn.completed` object in the `JsonEvent` union (line 48-57) to add an optional `maxTurnsScope`:

```ts
| {
		type: 'turn.completed';
		timestamp: string;
		sessionId: string;
		status: TurnCompletedStatus;
		usage?: {
			numTurns: number;
			costUsd?: number;
		};
		maxTurnsScope?: 'outer' | 'subagent';
  };
```

- [ ] **Step 2: Update `emitTurnCompleted` signature in `JsonAdapter`**

In `apps/cli/ai/output-adapter.ts`, modify `emitTurnCompleted` (line 135) to accept the scope:

```ts
emitTurnCompleted(
	status: TurnCompletedStatus,
	usage?: { numTurns: number; costUsd?: number },
	maxTurnsScope?: 'outer' | 'subagent'
): void {
	emitEvent( {
		type: 'turn.completed',
		timestamp: new Date().toISOString(),
		sessionId: this.sessionId ?? '',
		status,
		usage,
		maxTurnsScope,
	} );
}
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: No errors.

- [ ] **Step 4: Lint**

Run: `npx eslint --fix apps/cli/ai/json-events.ts apps/cli/ai/output-adapter.ts`
Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add apps/cli/ai/json-events.ts apps/cli/ai/output-adapter.ts
git commit -m "Add maxTurnsScope to JSON turn.completed event"
```

---

## Task 5: Extract `maybePromptContinue` helper and wire outer branch through it

**Files:**
- Modify: `apps/cli/commands/ai/index.ts`

- [ ] **Step 1: Add helper types and function**

In `apps/cli/commands/ai/index.ts`, above the `runCommand` export (around line 44), add:

```ts
type ContinueReason =
	| { kind: 'outer'; numTurns: number }
	| { kind: 'subagent'; lastProgress: string | null };

interface ContinueDecision {
	resumePrompt: string;
}

async function maybePromptContinue(
	ui: AiOutputAdapter,
	reason: ContinueReason
): Promise< ContinueDecision | null > {
	let question: string;
	let resumePrompt: string;

	if ( reason.kind === 'outer' ) {
		ui.showInfo(
			sprintf(
				/* translators: %d: number of turns used */
				_n( 'Used %d turn', 'Used %d turns', reason.numTurns ),
				reason.numTurns
			)
		);
		question = __( 'Reached the turn limit. Continue?' );
		resumePrompt = 'Continue from where you left off.';
	} else if ( reason.lastProgress ) {
		const snippet = reason.lastProgress;
		question = sprintf(
			/* translators: %s: last visible progress snippet from the subagent */
			__( 'A subagent hit its turn limit. Last progress: "%s". Continue?' ),
			snippet
		);
		resumePrompt =
			`Your previous Task subagent stopped at: "${ snippet }". ` +
			'Re-dispatch the Task with a more focused scope to continue from there, ' +
			'or complete the remaining work inline.';
	} else {
		question = __( 'A subagent hit its turn limit mid-task. Continue?' );
		resumePrompt =
			'Your previous Task subagent hit its turn limit. Re-dispatch the same Task ' +
			'with a more focused scope (e.g. smaller batch), or complete the remaining ' +
			'work inline without a subagent.';
	}

	const answer = await ui.askUser( [
		{
			question,
			options: [
				{ label: 'Yes', description: __( 'Resume where the agent left off' ) },
				{ label: 'No', description: __( 'Stop here' ) },
			],
		},
	] );
	const choice = Object.values( answer )[ 0 ]?.toLowerCase();
	if ( choice !== 'yes' ) {
		return null;
	}
	return { resumePrompt };
}
```

- [ ] **Step 2: Rewire existing outer-turn branch**

Replace the block at `apps/cli/commands/ai/index.ts:441-463` (the current inline `if ( maxTurnsResult ) { ... }`) with:

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

if ( continueReason && ! isJsonMode ) {
	const decision = await maybePromptContinue( ui, continueReason );
	if ( decision ) {
		ui.addUserMessage( 'Continue' );
		return runAgentTurn( decision.resumePrompt );
	}
}
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: No errors.

- [ ] **Step 4: Manual smoke — existing outer path still works**

Run: `npm run cli:build && node apps/cli/dist/cli/main.mjs ai --help`
Expected: Command resolves normally (no runtime import errors).

(Full end-to-end of the outer path is hard to trigger in a unit test; covered by Task 7's integration test below.)

- [ ] **Step 5: Lint**

Run: `npx eslint --fix apps/cli/commands/ai/index.ts`
Expected: No errors.

- [ ] **Step 6: Commit**

```bash
git add apps/cli/commands/ai/index.ts
git commit -m "Extract maybePromptContinue and add subagent continue branch"
```

---

## Task 6: Emit `maxTurnsScope` from JSON mode when a subagent ran out

**Files:**
- Modify: `apps/cli/commands/ai/index.ts`

- [ ] **Step 1: Plumb the scope into `emitTurnCompleted`**

In `apps/cli/commands/ai/index.ts`, find the JSON-mode block (around line 471-488). The current call `( ui as JsonAdapter ).emitTurnCompleted( jsonStatus, result.usage );` needs to pass scope.

Replace the JSON-mode block with:

```ts
if ( isJsonMode && options.initialMessage ) {
	try {
		ui.addUserMessage( options.initialMessage );
		const result = await runAgentTurn( options.initialMessage );
		const jsonStatus = result.status === 'interrupted' ? 'error' : result.status;
		let maxTurnsScope: 'outer' | 'subagent' | undefined;
		if ( jsonStatus === 'max_turns' ) {
			maxTurnsScope = 'outer';
		} else if ( ui.subagentMaxTurns ) {
			maxTurnsScope = 'subagent';
		}
		( ui as JsonAdapter ).emitTurnCompleted( jsonStatus, result.usage, maxTurnsScope );
	} catch ( error ) {
		process.exitCode = 1;
		handleAgentTurnError( error );
		( ui as JsonAdapter ).emitTurnCompleted( 'error' );
	} finally {
		await persistQueue;
		ui.stop();
		await closeSharedBrowser();
	}
	return;
}
```

Note that the existing `TurnCompletedStatus` already includes `'max_turns'`, so a subagent event in an otherwise-successful outer turn still surfaces as `status: 'success'` with `maxTurnsScope: 'subagent'` — which is the correct semantic (the outer turn *did* succeed; a subagent inside it hit a limit).

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: No errors.

- [ ] **Step 3: Lint**

Run: `npx eslint --fix apps/cli/commands/ai/index.ts`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add apps/cli/commands/ai/index.ts
git commit -m "Emit maxTurnsScope on JSON turn.completed"
```

---

## Task 7: Integration test — JsonAdapter detects subagent max-turns end-to-end

**Files:**
- Test: `apps/cli/ai/tests/output-adapter.test.ts` (create if missing)

- [ ] **Step 1: Write the failing test**

Create `apps/cli/ai/tests/output-adapter.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { JsonAdapter } from 'cli/ai/output-adapter';

describe( 'JsonAdapter subagent max-turns detection', () => {
	it( 'sets subagentMaxTurns when a Task tool_result contains the marker', () => {
		const adapter = new JsonAdapter();
		vi.spyOn( process.stdout, 'write' ).mockImplementation( () => true );

		adapter.handleMessage( {
			type: 'user',
			parent_tool_use_id: 'task-1',
			tool_use_result: {
				content: [
					{ type: 'text', text: 'Updated product 21.' },
					{
						type: 'text',
						text: 'Claude Code returned an error result: Reached maximum number of turns (50)',
					},
				],
			},
			message: { content: [] },
		} as never );

		expect( adapter.subagentMaxTurns ).toEqual( { lastProgress: 'Updated product 21.' } );
	} );

	it( 'resets subagentMaxTurns at the start of a new turn', () => {
		const adapter = new JsonAdapter();
		vi.spyOn( process.stdout, 'write' ).mockImplementation( () => true );
		adapter.subagentMaxTurns = { lastProgress: 'stale' };

		adapter.beginAgentTurn();

		expect( adapter.subagentMaxTurns ).toBeNull();
	} );

	it( 'emits maxTurnsScope on turn.completed when provided', () => {
		const adapter = new JsonAdapter();
		const written: string[] = [];
		vi.spyOn( process.stdout, 'write' ).mockImplementation( ( chunk ) => {
			written.push( String( chunk ) );
			return true;
		} );

		adapter.emitTurnCompleted( 'success', { numTurns: 12 }, 'subagent' );

		const event = JSON.parse( written[ 0 ] );
		expect( event.type ).toBe( 'turn.completed' );
		expect( event.status ).toBe( 'success' );
		expect( event.maxTurnsScope ).toBe( 'subagent' );
	} );
} );
```

- [ ] **Step 2: Run test to verify it passes**

Run: `npm test -- apps/cli/ai/tests/output-adapter.test.ts`
Expected: PASS (3 tests). Tests pass because Tasks 3-4 already implemented the behavior; this task pins it.

- [ ] **Step 3: Lint**

Run: `npx eslint --fix apps/cli/ai/tests/output-adapter.test.ts`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add apps/cli/ai/tests/output-adapter.test.ts
git commit -m "Add JsonAdapter subagent max-turns integration tests"
```

---

## Task 8: Full verification pass

- [ ] **Step 1: Run the full CLI test suite**

Run: `npm test -- apps/cli/ai`
Expected: All tests pass, including the three new test files:
- `apps/cli/ai/tests/subagent-max-turns.test.ts`
- `apps/cli/ai/tests/ui.test.ts` (existing + new cases)
- `apps/cli/ai/tests/output-adapter.test.ts`

- [ ] **Step 2: Typecheck and lint the whole modified set**

Run: `npm run typecheck && npx eslint --fix apps/cli/ai apps/cli/commands/ai`
Expected: No errors.

- [ ] **Step 3: Build the CLI**

Run: `npm run cli:build`
Expected: Clean build.

- [ ] **Step 4: Smoke the command boots**

Run: `node apps/cli/dist/cli/main.mjs ai --help`
Expected: Help text prints without runtime errors.

- [ ] **Step 5: Final commit (only if post-fix changes were needed)**

If lint or typecheck produced any auto-fixes, commit them:

```bash
git status
# If there are changes:
git add -u
git commit -m "Lint/format fixes for subagent max-turns feature"
```

---

## Notes on open questions from the spec

- **Structured SDK field:** This plan ships with string-match detection only, guarded by the pinned-marker test. If during implementation you discover the SDK exposes a structured error subtype on Task tool results (e.g. `tool_use_result.is_error` + a categorized cause), add a preference-first branch inside `detectSubagentMaxTurns` without removing the string fallback. The existing tests continue to pin the string contract.
- **`lastProgress` extraction source:** This plan extracts progress from text blocks inside the Task tool_result's `content` array. If the SDK surfaces subagent assistant messages only through the streamed `parent_tool_use_id` path (separately from the tool_result), capture them as they arrive by keeping a `Map<parentToolUseId, lastText>` in `AiChatUI` and pass its value into the detector when the tool_result arrives. Plan-wise, this is a small follow-up: swap the `rawContent` argument in Task 2 Step 4 for the captured text when the SDK doesn't carry it inline.