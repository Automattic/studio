/**
 * PromptFoo eval runner for Studio Code agent.
 *
 * Hooks into runStudioAgentTurn() to capture tool calls, tool results, and
 * assistant text. Returns raw structured data — assertions live in the
 * promptfoo config, not here.
 */

import { writeFileSync, writeSync as fsWriteSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SessionManager } from '@earendil-works/pi-coding-agent';
import { isAiModelId, type AiModelId } from '@studio/common/ai/models';
import { findLastAssistant } from '@studio/common/ai/session-events';
import {
	resolveAiEnvironment,
	resolveInitialAiProvider,
	resolveUnavailableAiProvider,
} from 'cli/ai/auth';
import { runStudioAgentTurn } from 'cli/ai/runtimes/pi';
import { STUDIO_SITES_ROOT } from 'cli/lib/site-paths';
import type { AgentSessionEvent } from '@earendil-works/pi-coding-agent';
import type { AiProviderId } from 'cli/ai/providers';

interface EvalRunnerInput {
	prompt: string;
	timeoutMs?: number;
	model?: AiModelId;
}

function extractToolCalls( event: AgentSessionEvent ) {
	if ( event.type !== 'message_end' || event.message.role !== 'assistant' ) {
		return [];
	}
	return event.message.content
		.filter(
			(
				block
			): block is Extract< ( typeof event.message.content )[ number ], { type: 'toolCall' } > =>
				block.type === 'toolCall'
		)
		.map( ( block ) => ( {
			id: block.id,
			name: block.name,
			input: block.arguments as Record< string, unknown >,
		} ) );
}

type ToolCallRecord = {
	id: string;
	name: string;
	input: unknown;
};

type ToolEvent = {
	toolUseId: string;
	toolName: string;
	input: unknown;
	startedAtMs: number;
	endedAtMs?: number;
	durationMs?: number;
	isError?: boolean;
	turnIndex: number;
};

type FirstToolError = {
	toolUseId: string | null;
	toolName: string | null;
	input?: unknown;
	error: string;
	turnIndex: number;
};

function extractTextSegments( event: AgentSessionEvent ): string[] {
	if ( event.type !== 'message_end' || event.message.role !== 'assistant' ) {
		return [];
	}
	return event.message.content
		.filter( ( block ): block is { type: 'text'; text: string } => block.type === 'text' )
		.map( ( block ) => block.text );
}

function extractToolResult( event: AgentSessionEvent ): {
	toolUseId: string;
	isError: boolean;
	text?: string;
} | null {
	if ( event.type !== 'tool_execution_end' ) {
		return null;
	}
	const result = event.result as { content?: Array< { type: string; text?: string } > } | undefined;
	let text: string | undefined;
	if ( result?.content && Array.isArray( result.content ) ) {
		const textBlock = result.content.find(
			( b ): b is { type: 'text'; text: string } => b.type === 'text' && typeof b.text === 'string'
		);
		if ( textBlock ) text = textBlock.text;
	}
	return { toolUseId: event.toolCallId, isError: event.isError, text };
}

function readInput(): EvalRunnerInput {
	const prompt = process.argv[ 2 ];
	if ( ! prompt ) {
		throw new Error( 'Missing prompt argument' );
	}

	let vars: Record< string, unknown > = {};
	if ( process.argv[ 4 ] ) {
		try {
			vars = JSON.parse( process.argv[ 4 ] )?.vars ?? {};
		} catch {
			// ignore
		}
	}

	const envModel = process.env.STUDIO_EVAL_MODEL?.trim();
	const varModel = typeof vars.model === 'string' ? vars.model.trim() : undefined;
	const rawModel = varModel || envModel;
	const model = rawModel && isAiModelId( rawModel ) ? rawModel : undefined;

	return {
		prompt: ( vars.prompt as string ) ?? prompt,
		timeoutMs: typeof vars.timeoutMs === 'number' ? vars.timeoutMs : undefined,
		model,
	};
}

async function runEval( input: EvalRunnerInput ) {
	const evalStartedAt = Date.now();
	const elapsed = () => Date.now() - evalStartedAt;
	const phaseTimingsMs: Record< string, number > = {};
	let phaseStartedAt = Date.now();

	let aiProvider: AiProviderId = await resolveInitialAiProvider();
	phaseTimingsMs.resolve_initial_provider_ms = Date.now() - phaseStartedAt;

	phaseStartedAt = Date.now();
	aiProvider = ( await resolveUnavailableAiProvider( aiProvider ) ) ?? aiProvider;
	phaseTimingsMs.resolve_unavailable_provider_ms = Date.now() - phaseStartedAt;

	phaseStartedAt = Date.now();
	const aiEnvironment = await resolveAiEnvironment( aiProvider );
	phaseTimingsMs.resolve_ai_environment_ms = Date.now() - phaseStartedAt;

	const env = {
		...( process.env as Record< string, string > ),
		...aiEnvironment,
	};
	// Allow running inside a Claude Code session
	delete env.CLAUDECODE;

	const toolCalls: ToolCallRecord[] = [];
	const toolResults: {
		toolUseId: string | null;
		toolName: string | null;
		isError: boolean;
		text?: string;
	}[] = [];
	const toolEvents: ToolEvent[] = [];
	const textSegments: string[] = [];
	const toolNameById = new Map< string, string >();
	const toolEventById = new Map< string, ToolEvent >();
	let firstToolError: FirstToolError | null = null;
	// Wall-clock per turn, measured between successive assistant messages.
	const turnDurationsMs: number[] = [];
	let turnIndex = 0;
	let numTurns = 0;
	let numTurnsResult: number | null = null;
	let success = false;
	let error: string | null = null;
	let timedOut = false;

	phaseStartedAt = Date.now();
	const session = SessionManager.inMemory( STUDIO_SITES_ROOT );
	const queryStartedAt = Date.now();
	let turnStart = queryStartedAt;

	const handleEvent = ( event: AgentSessionEvent ): void => {
		if ( event.type === 'message_end' && event.message.role === 'assistant' ) {
			const now = Date.now();
			turnDurationsMs.push( now - turnStart );
			turnIndex += 1;
			if ( turnIndex === 1 ) {
				phaseTimingsMs.first_assistant_message_ms = now - queryStartedAt;
			}
			turnStart = now;
		}
		for ( const tc of extractToolCalls( event ) ) {
			toolCalls.push( tc );
			toolNameById.set( tc.id, tc.name );
			const evt: ToolEvent = {
				toolUseId: tc.id,
				toolName: tc.name,
				input: tc.input,
				startedAtMs: elapsed(),
				turnIndex,
			};
			toolEvents.push( evt );
			toolEventById.set( tc.id, evt );
		}
		textSegments.push( ...extractTextSegments( event ) );

		if ( event.type === 'tool_execution_end' ) {
			const tr = extractToolResult( event );
			if ( tr ) {
				const id = tr.toolUseId;
				const evt = toolEventById.get( id );
				if ( evt ) {
					evt.endedAtMs = elapsed();
					evt.durationMs = evt.endedAtMs - evt.startedAtMs;
					evt.isError = tr.isError;
				}
				if ( tr.isError && ! firstToolError ) {
					firstToolError = {
						toolUseId: id,
						toolName: toolNameById.get( id ) ?? null,
						...( evt?.input ? { input: evt.input } : {} ),
						error: tr.text ?? 'Tool returned an error result.',
						turnIndex,
					};
				}
				toolResults.push( {
					toolUseId: id,
					toolName: toolNameById.get( id ) ?? null,
					isError: tr.isError,
					...( tr.text ? { text: tr.text } : {} ),
				} );
			}
		}

		if ( event.type === 'turn_end' ) {
			numTurns += 1;
		}

		if ( event.type === 'agent_end' ) {
			const lastAssistant = findLastAssistant( event.messages );
			success =
				! lastAssistant ||
				( lastAssistant.stopReason !== 'error' && lastAssistant.stopReason !== 'aborted' );
			numTurnsResult = numTurns;
		}
	};

	const query = runStudioAgentTurn( {
		prompt: input.prompt.trim(),
		env,
		session,
		onEvent: handleEvent,
		...( input.model ? { model: input.model } : {} ),
	} );
	phaseTimingsMs.start_ai_agent_ms = Date.now() - phaseStartedAt;

	const timeout = setTimeout( () => {
		timedOut = true;
		void query.interrupt();
	}, input.timeoutMs ?? 300000 );

	try {
		await query.result;
	} catch ( caught ) {
		error = caught instanceof Error ? caught.message : String( caught );
	} finally {
		clearTimeout( timeout );
	}
	phaseTimingsMs.total_eval_ms = elapsed();

	return {
		success,
		error,
		timedOut,
		numTurns: numTurnsResult,
		phaseTimingsMs,
		turnDurationsMs,
		toolCalls,
		toolResults,
		toolEvents,
		firstToolError,
		textSegments,
	};
}

const RESULT_PREFIX = 'EVAL_RUNNER_RESULT_FILE=';

// Studio tools and the Agent SDK freely print to stdout (pi-tui spinners,
// daemon status, …). promptfoo's `exec:` provider wraps us in
// `child_process.exec`, whose default 1 MB stdout buffer long runs overflow.
// Redirect stdout writes to stderr during the run, serialize the result to a
// tmp file, and emit only `EVAL_RUNNER_RESULT_FILE=<path>` via a raw
// `fs.writeSync(1, …)` that bypasses the wrapper.
async function main() {
	const filePath = path.join( os.tmpdir(), `studio-eval-${ Date.now() }-${ process.pid }.json` );

	( process.stdout as unknown as { write: ( ...args: unknown[] ) => boolean } ).write = (
		...args: unknown[]
	) => {
		return ( process.stderr.write as unknown as ( ...args: unknown[] ) => boolean )( ...args );
	};
	const rawStdout = ( line: string ) => fsWriteSync( 1, line );
	const emit = ( payload: unknown ) => {
		try {
			writeFileSync( filePath, JSON.stringify( payload ) );
			rawStdout( `${ RESULT_PREFIX }${ filePath }` );
		} catch ( writeError ) {
			const msg = writeError instanceof Error ? writeError.message : String( writeError );
			process.stderr.write( `[eval-runner] failed to write ${ filePath }: ${ msg }\n` );
			rawStdout( JSON.stringify( { success: false, error: msg } ) );
		}
	};

	let exitCode = 0;
	try {
		emit( await runEval( readInput() ) );
	} catch ( error ) {
		emit( { success: false, error: error instanceof Error ? error.message : String( error ) } );
		exitCode = 1;
	}
	// The Agent SDK keeps internal handles open past conversation end; bail out
	// rather than leaving promptfoo waiting on its exec child.
	process.exit( exitCode );
}

void main();
