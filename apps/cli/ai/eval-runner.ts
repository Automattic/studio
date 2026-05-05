/**
 * PromptFoo eval runner for Studio Code agent.
 *
 * Hooks into startAiAgent() to capture tool calls, tool results, and
 * assistant text. Returns raw structured data — assertions live in the
 * promptfoo config, not here.
 */

import { writeFileSync, writeSync as fsWriteSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isAiModelId, type AiModelId } from '@studio/common/ai/models';
import { startAiAgent } from 'cli/ai/agent';
import {
	resolveAiEnvironment,
	resolveInitialAiProvider,
	resolveUnavailableAiProvider,
} from 'cli/ai/auth';
import type { AiProviderId } from 'cli/ai/providers';
import type { SDKMessage } from 'cli/ai/runtimes/messages';

interface EvalRunnerInput {
	prompt: string;
	timeoutMs?: number;
	model?: AiModelId;
}

function normalizeToolName( name: string ): string {
	return name.replace( /^mcp__studio__/, '' );
}

function extractToolCalls( message: SDKMessage ) {
	if ( message.type !== 'assistant' ) {
		return [];
	}
	const content = message.message.content ?? [];
	return content
		.filter(
			( block ): block is Extract< ( typeof content )[ number ], { type: 'tool_use' } > =>
				block.type === 'tool_use'
		)
		.map( ( block ) => ( {
			id: block.id,
			name: normalizeToolName( block.name ),
			input: block.input,
		} ) );
}

type TextBlock = { type: 'text'; text: string };
type ToolResultBlock = {
	type: 'tool_result';
	tool_use_id: string;
	is_error?: boolean;
	content?: unknown;
};

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

type TranscriptEvent = {
	index: number;
	type: SDKMessage[ 'type' ];
	turnIndex: number;
	elapsedMs: number;
	text?: string[];
	toolCalls?: ToolCallRecord[];
	toolResult?: {
		toolUseId: string | null;
		toolName: string | null;
		isError: boolean;
		text?: string;
	};
	stopReason?: string | null;
	result?: string;
	subtype?: string;
	isError?: boolean;
	errors?: string[];
	numTurns?: number;
};

function truncateText( value: string, maxLength = 4000 ): string {
	return value.length > maxLength
		? `${ value.slice( 0, maxLength ) }…[truncated ${ value.length - maxLength } chars]`
		: value;
}

function extractTextSegments( message: SDKMessage ): string[] {
	if ( message.type !== 'assistant' ) {
		return [];
	}
	const content = ( message.message.content ?? [] ) as Array< { type: string } >;
	return content
		.filter( ( block ): block is TextBlock => block.type === 'text' )
		.map( ( block ) => block.text );
}

function extractToolResult( message: SDKMessage ): {
	toolUseId: string | null;
	isError: boolean;
	text?: string;
} | null {
	if ( message.type !== 'user' || ! Array.isArray( message.message.content ) ) {
		return null;
	}
	const content = message.message.content as Array< { type: string } >;
	const block = content.find( ( b ): b is ToolResultBlock => b.type === 'tool_result' );
	if ( ! block ) {
		return null;
	}
	let text: string | undefined;
	if ( typeof block.content === 'string' ) {
		text = block.content;
	} else if ( Array.isArray( block.content ) ) {
		const tb = ( block.content as Array< { type: string } > ).find(
			( b ): b is TextBlock => b.type === 'text'
		);
		if ( tb ) {
			text = tb.text;
		}
	}
	return { toolUseId: block.tool_use_id ?? null, isError: block.is_error === true, text };
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
	const transcript: TranscriptEvent[] = [];
	const includeTranscript = process.env.STUDIO_EVAL_INCLUDE_TRANSCRIPT === '1';
	const toolNameById = new Map< string, string >();
	const toolEventById = new Map< string, ToolEvent >();
	let firstToolError: FirstToolError | null = null;
	// Wall-clock per turn, measured between successive assistant messages.
	const turnDurationsMs: number[] = [];
	let turnIndex = 0;
	let numTurns: number | null = null;
	let success = false;
	let error: string | null = null;
	let timedOut = false;
	let resultStopReason: string | null = null;
	let resultText = '';
	let resultSubtype: string | null = null;
	let resultIsError = false;
	let resultErrors: string[] = [];
	let messageIndex = 0;

	phaseStartedAt = Date.now();
	const query = startAiAgent( {
		prompt: input.prompt.trim(),
		env,
		...( input.model ? { model: input.model } : {} ),
	} );
	phaseTimingsMs.start_ai_agent_ms = Date.now() - phaseStartedAt;

	const queryStartedAt = Date.now();
	let turnStart = queryStartedAt;

	const timeout = setTimeout( () => {
		timedOut = true;
		void query.interrupt();
	}, input.timeoutMs ?? 300000 );

	try {
		for await ( const message of query ) {
			messageIndex += 1;
			const event: TranscriptEvent = {
				index: messageIndex,
				type: message.type,
				turnIndex,
				elapsedMs: elapsed(),
			};
			if ( message.type === 'assistant' ) {
				const now = Date.now();
				turnDurationsMs.push( now - turnStart );
				turnIndex += 1;
				event.turnIndex = turnIndex;
				if ( turnIndex === 1 ) {
					phaseTimingsMs.first_assistant_message_ms = now - queryStartedAt;
				}
				turnStart = now;
				event.stopReason = message.message.stop_reason ?? null;
			}
			const messageToolCalls = extractToolCalls( message );
			if ( messageToolCalls.length ) {
				event.toolCalls = messageToolCalls;
			}
			for ( const tc of messageToolCalls ) {
				toolCalls.push( tc );
				toolNameById.set( tc.id, tc.name );
				const toolEvent: ToolEvent = {
					toolUseId: tc.id,
					toolName: tc.name,
					input: tc.input,
					startedAtMs: elapsed(),
					turnIndex,
				};
				toolEvents.push( toolEvent );
				toolEventById.set( tc.id, toolEvent );
			}
			const messageTextSegments = extractTextSegments( message );
			if ( messageTextSegments.length ) {
				event.text = messageTextSegments.map( ( text ) => truncateText( text ) );
			}
			textSegments.push( ...messageTextSegments );

			if ( message.type === 'user' ) {
				const tr = extractToolResult( message );
				if ( tr ) {
					const id = tr.toolUseId ?? message.parent_tool_use_id ?? null;
					const toolEvent = id ? toolEventById.get( id ) : undefined;
					if ( toolEvent ) {
						toolEvent.endedAtMs = elapsed();
						toolEvent.durationMs = toolEvent.endedAtMs - toolEvent.startedAtMs;
						toolEvent.isError = tr.isError;
					}
					event.toolResult = {
						toolUseId: id,
						toolName: id ? toolNameById.get( id ) ?? null : null,
						isError: tr.isError,
						...( tr.text ? { text: truncateText( tr.text ) } : {} ),
					};
					if ( tr.isError && ! firstToolError ) {
						firstToolError = {
							toolUseId: id,
							toolName: id ? toolNameById.get( id ) ?? null : null,
							...( toolEvent?.input ? { input: toolEvent.input } : {} ),
							error: tr.text ?? 'Tool returned an error result.',
							turnIndex,
						};
					}
					toolResults.push( {
						toolUseId: id,
						toolName: id ? toolNameById.get( id ) ?? null : null,
						isError: tr.isError,
						...( tr.text ? { text: tr.text } : {} ),
					} );
				}
			}

			if ( message.type === 'result' ) {
				success = message.subtype === 'success';
				numTurns = message.num_turns ?? null;
				resultStopReason = message.stop_reason ?? null;
				resultText = message.result ?? '';
				resultSubtype = message.subtype ?? null;
				resultIsError = message.is_error === true;
				resultErrors = Array.isArray( message.errors ) ? message.errors : [];
				event.subtype = message.subtype;
				event.isError = message.is_error;
				event.stopReason = message.stop_reason ?? null;
				event.result = truncateText( message.result ?? '' );
				event.numTurns = message.num_turns;
				if ( resultErrors.length ) {
					event.errors = resultErrors;
				}
			}
			if ( includeTranscript ) {
				transcript.push( event );
			}
		}
	} catch ( caught ) {
		error = caught instanceof Error ? caught.message : String( caught );
	} finally {
		clearTimeout( timeout );
	}
	phaseTimingsMs.total_eval_ms = elapsed();
	if ( success && ! textSegments.length && ! resultText.trim() ) {
		success = false;
		error = 'Agent completed without assistant text or result output.';
	}

	return {
		success,
		error,
		timedOut,
		numTurns,
		resultSubtype,
		resultIsError,
		resultStopReason,
		resultText,
		resultErrors,
		phaseTimingsMs,
		turnDurationsMs,
		toolCalls,
		toolResults,
		toolEvents,
		firstToolError,
		textSegments,
		...( includeTranscript ? { transcript } : {} ),
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
