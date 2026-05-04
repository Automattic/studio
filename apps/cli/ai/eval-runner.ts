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
import { startAiAgent } from 'cli/ai/agent';
import {
	resolveAiEnvironment,
	resolveInitialAiProvider,
	resolveUnavailableAiProvider,
} from 'cli/ai/auth';
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import type { AiProviderId } from 'cli/ai/providers';

interface EvalRunnerInput {
	prompt: string;
	timeoutMs?: number;
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
			( block: {
				type: string;
			} ): block is { type: 'tool_use'; id: string; name: string; input: unknown } =>
				block.type === 'tool_use'
		)
		.map( ( block: { id: string; name: string; input: unknown } ) => ( {
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

	return {
		prompt: ( vars.prompt as string ) ?? prompt,
		timeoutMs: typeof vars.timeoutMs === 'number' ? vars.timeoutMs : undefined,
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
	let numTurns: number | null = null;
	let success = false;
	let error: string | null = null;
	let timedOut = false;

	phaseStartedAt = Date.now();
	const query = startAiAgent( {
		prompt: input.prompt.trim(),
		env,
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
			if ( message.type === 'assistant' ) {
				const now = Date.now();
				turnDurationsMs.push( now - turnStart );
				turnIndex += 1;
				if ( turnIndex === 1 ) {
					phaseTimingsMs.first_assistant_message_ms = now - queryStartedAt;
				}
				turnStart = now;
			}
			for ( const tc of extractToolCalls( message ) ) {
				toolCalls.push( tc );
				toolNameById.set( tc.id, tc.name );
				const event: ToolEvent = {
					toolUseId: tc.id,
					toolName: tc.name,
					input: tc.input,
					startedAtMs: elapsed(),
					turnIndex,
				};
				toolEvents.push( event );
				toolEventById.set( tc.id, event );
			}
			textSegments.push( ...extractTextSegments( message ) );

			if ( message.type === 'user' ) {
				const tr = extractToolResult( message );
				if ( tr ) {
					const id = tr.toolUseId ?? message.parent_tool_use_id ?? null;
					const event = id ? toolEventById.get( id ) : undefined;
					if ( event ) {
						event.endedAtMs = elapsed();
						event.durationMs = event.endedAtMs - event.startedAtMs;
						event.isError = tr.isError;
					}
					if ( tr.isError && ! firstToolError ) {
						firstToolError = {
							toolUseId: id,
							toolName: id ? toolNameById.get( id ) ?? null : null,
							...( event?.input ? { input: event.input } : {} ),
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
			}
		}
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
		numTurns,
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
