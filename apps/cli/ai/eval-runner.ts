/**
 * PromptFoo eval runner for Studio Code agent.
 *
 * Hooks into startAiAgent() to capture tool calls, tool results, assistant text,
 * and permission questions. Returns raw structured data — assertions live in the
 * promptfoo config, not here.
 */

import { appendFileSync, writeFileSync, writeSync as fsWriteSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startAiAgent, type AskUserQuestion } from 'cli/ai/agent';
import {
	resolveAiEnvironment,
	resolveInitialAiProvider,
	resolveUnavailableAiProvider,
} from 'cli/ai/auth';
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import type { AiProviderId } from 'cli/ai/providers';

interface EvalRunnerInput {
	prompt: string;
	maxTurns?: number;
	timeoutMs?: number;
	askUserPolicy?: 'allow_all' | 'first_option' | 'deny_permissions_allow_other';
}

function normalizeToolName( name: string ): string {
	return name.replace( /^mcp__studio__/, '' );
}

function hasPermissionOptions( options: string[] ): boolean {
	return options.some( ( o ) => /\b(deny|allow once|allow for this session)\b/i.test( o ) );
}

function pickAnswer( question: string, options: string[], policy: string ): string {
	if ( policy === 'allow_all' || policy === 'first_option' ) {
		return options[ 0 ] ?? 'yes';
	}

	if ( hasPermissionOptions( options ) ) {
		const denyOption = options.find( ( o ) => /\bdeny\b/i.test( o ) );
		return denyOption ?? options[ options.length - 1 ] ?? 'no';
	}
	return options[ 0 ] ?? 'yes';
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
		.map( ( block: { id: string; name: string } ) => ( {
			id: block.id,
			name: normalizeToolName( block.name ),
		} ) );
}

function extractTextSegments( message: SDKMessage ): string[] {
	if ( message.type !== 'assistant' ) {
		return [];
	}
	const content = message.message.content ?? [];
	return content
		.filter(
			( block: { type: string } ): block is { type: 'text'; text: string } => block.type === 'text'
		)
		.map( ( block: { text: string } ) => block.text );
}

function extractToolResult( message: SDKMessage ): {
	toolUseId: string | null;
	isError: boolean;
	text?: string;
} | null {
	if ( message.type !== 'user' || ! Array.isArray( message.message.content ) ) {
		return null;
	}
	const block = message.message.content.find(
		( b: {
			type: string;
		} ): b is { type: 'tool_result'; tool_use_id: string; is_error?: boolean; content?: unknown } =>
			b.type === 'tool_result'
	);
	if ( ! block ) {
		return null;
	}
	let text: string | undefined;
	if ( typeof block.content === 'string' ) {
		text = block.content;
	} else if ( Array.isArray( block.content ) ) {
		const tb = block.content.find( ( b: { type: string } ) => b.type === 'text' );
		if ( tb && 'text' in tb ) {
			text = tb.text as string;
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
		maxTurns: typeof vars.maxTurns === 'number' ? vars.maxTurns : undefined,
		timeoutMs: typeof vars.timeoutMs === 'number' ? vars.timeoutMs : undefined,
		askUserPolicy: vars.askUserPolicy as EvalRunnerInput[ 'askUserPolicy' ],
	};
}

function heartbeat( line: string ) {
	if ( ! process.env.EVAL_RUNNER_HEARTBEAT ) {
		return;
	}
	const stamped = `[${ new Date().toISOString() }] ${ line }\n`;
	// Write to both stderr (in case the caller is tailing it) and an opt-in
	// log file (handy because promptfoo's `exec:` provider captures stderr).
	process.stderr.write( stamped );
	const logFile = process.env.EVAL_RUNNER_HEARTBEAT_FILE;
	if ( logFile ) {
		try {
			appendFileSync( logFile, stamped );
		} catch {
			// best-effort only
		}
	}
}

async function runEval( input: EvalRunnerInput ) {
	const policy = input.askUserPolicy ?? 'deny_permissions_allow_other';
	heartbeat( `run start prompt="${ input.prompt.slice( 0, 80 ) }"` );

	let aiProvider: AiProviderId = await resolveInitialAiProvider();
	aiProvider = ( await resolveUnavailableAiProvider( aiProvider ) ) ?? aiProvider;

	const env = {
		...( process.env as Record< string, string > ),
		...( await resolveAiEnvironment( aiProvider ) ),
	};
	// Allow running inside a Claude Code session
	delete env.CLAUDECODE;

	const toolCalls: { id: string; name: string }[] = [];
	const toolResults: {
		toolUseId: string | null;
		toolName: string | null;
		isError: boolean;
		text?: string;
	}[] = [];
	const textSegments: string[] = [];
	const questions: {
		question: string;
		options: string[];
		answer: string;
		isPermission: boolean;
	}[] = [];
	const toolNameById = new Map< string, string >();
	// Wall-clock time taken by each assistant turn. Measured from the start of
	// the run (or the end of the previous assistant message) until the next
	// assistant message arrives. Slow individual turns stall the UI even when
	// the overall build eventually succeeds — tests assert on the max here.
	const turnDurationsMs: number[] = [];
	let turnStart = Date.now();
	let numTurns: number | null = null;
	let success = false;

	const query = startAiAgent( {
		prompt: input.prompt.trim(),
		env,
		maxTurns: input.maxTurns ?? 50,
		onAskUser: async ( qs: AskUserQuestion[] ) => {
			const answers: Record< string, string > = {};
			for ( const q of qs ) {
				const opts = q.options.map( ( o ) => o.label );
				const answer = pickAnswer( q.question, opts, policy );
				answers[ q.question ] = answer;
				questions.push( {
					question: q.question,
					options: opts,
					answer,
					isPermission: hasPermissionOptions( opts ),
				} );
			}
			return answers;
		},
	} );

	const timeout = setTimeout( () => void query.interrupt(), input.timeoutMs ?? 300000 );

	try {
		for await ( const message of query ) {
			if ( message.type === 'assistant' ) {
				const now = Date.now();
				const ms = now - turnStart;
				turnDurationsMs.push( ms );
				turnStart = now;
				heartbeat( `turn ${ turnDurationsMs.length } in ${ ms }ms` );
			}
			for ( const tc of extractToolCalls( message ) ) {
				toolCalls.push( tc );
				toolNameById.set( tc.id, tc.name );
				heartbeat( `  tool_use ${ tc.name }` );
			}
			textSegments.push( ...extractTextSegments( message ) );
			if ( message.type === 'user' ) {
				heartbeat( '  tool_result' );
			}

			if ( message.type === 'user' ) {
				const tr = extractToolResult( message );
				if ( tr ) {
					const id = tr.toolUseId ?? message.parent_tool_use_id ?? null;
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
	} finally {
		clearTimeout( timeout );
	}

	return { success, numTurns, turnDurationsMs, toolCalls, toolResults, textSegments, questions };
}

const RESULT_PREFIX = 'EVAL_RUNNER_RESULT_FILE=';

// Sink the runner's JSON result into a temp file and print only the file
// path on stdout. Two problems this solves:
//
// 1. Studio tools and the Agent SDK freely print to stdout (pi-tui spinners,
//    "Loading site…", daemon status, …). Mixing that with a JSON blob means
//    `JSON.parse(output)` in the assertions dies on the first spinner frame.
//
// 2. promptfoo wraps `exec:` providers in `child_process.exec`, whose
//    default `maxBuffer` is 1MB. A long site-build happily exceeds that
//    just from spinner/daemon chatter; exec kills the child with
//    ERR_CHILD_PROCESS_STDIO_MAXBUFFER and promptfoo marks the test as
//    errored. Also silence every other stdout writer during the run so the
//    buffer only ever carries the final marker line.
//
// Assertions then read the file by resolving the marker on stdout; see
// the inline assert code in `eval/promptfoo.config.yaml`.
async function main() {
	const filePath = path.join( os.tmpdir(), `studio-eval-${ Date.now() }-${ process.pid }.json` );

	// Silence everyone writing to this process's stdout for the duration of
	// the run. The SDK's own IPC talks to its `claude` subprocess via
	// dedicated pipes, not this process's stdout, so the redirect can't
	// corrupt agent messages. We emit the final marker with a raw
	// `fs.writeSync(1, …)` that bypasses the wrapper entirely.
	( process.stdout as unknown as { write: ( ...args: unknown[] ) => boolean } ).write = (
		...args: unknown[]
	) => {
		return ( process.stderr.write as unknown as ( ...args: unknown[] ) => boolean )( ...args );
	};
	const rawStdout = ( line: string ) => {
		fsWriteSync( 1, line );
	};
	const emit = ( payload: unknown ) => {
		try {
			writeFileSync( filePath, JSON.stringify( payload ) );
		} catch ( writeError ) {
			// If we can't even write the result file, fall back to emitting the
			// error inline so promptfoo sees SOMETHING rather than an empty stdout.
			process.stderr.write(
				`[eval-runner] failed to write result file ${ filePath }: ${
					writeError instanceof Error ? writeError.message : String( writeError )
				}\n`
			);
			rawStdout(
				JSON.stringify( {
					success: false,
					error: `failed to write result file: ${
						writeError instanceof Error ? writeError.message : String( writeError )
					}`,
				} )
			);
			return;
		}
		rawStdout( `${ RESULT_PREFIX }${ filePath }` );
	};

	let exitCode = 0;
	try {
		emit( await runEval( readInput() ) );
	} catch ( error ) {
		emit( {
			success: false,
			error: error instanceof Error ? error.message : String( error ),
		} );
		exitCode = 1;
	}
	// The Claude Agent SDK keeps internal handles open after the conversation
	// ends (its `claude` subprocess, ipc pipes, heartbeat timers). Letting
	// the event loop drain them takes an unbounded amount of time — we've
	// already emitted the result file, so bail out hard instead of leaving
	// promptfoo waiting on the exec child.
	process.exit( exitCode );
}

void main();
