import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, appendFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { createTokenUsage } from '@studio/agent/node';
import { matchesStopRule, type StopRule } from 'cli/ai/eval-stop';
import type { HarnessInput, HarnessContext, HarnessTranscript } from './types';

export function emptyClaudeTranscript( model?: string ): HarnessTranscript {
	return {
		success: false,
		error: null,
		timedOut: false,
		stoppedAt: null,
		model,
		numTurns: null,
		stopReason: null,
		errorMessage: null,
		usage: createTokenUsage(),
		sessionFile: null,
		phaseTimingsMs: {},
		requests: [],
		turnDurationsMs: [],
		toolCalls: [],
		toolResults: [],
		toolEvents: [],
		firstToolError: null,
		textSegments: [],
		questions: [],
	};
}

interface StreamBlock {
	type: string;
	text?: string;
	id?: string;
	name?: string;
	input?: unknown;
	tool_use_id?: string;
	is_error?: boolean;
	content?: string | Array< { type: string; text?: string } >;
}

export interface ClaudeStreamEvent {
	type: string;
	session_id?: string;
	message?: { id?: string; model?: string; content?: StreamBlock[] };
	subtype?: string;
	is_error?: boolean;
	num_turns?: number;
	result?: string;
	errors?: string[];
	usage?: {
		input_tokens?: number;
		output_tokens?: number;
		cache_read_input_tokens?: number;
		cache_creation_input_tokens?: number;
	};
}

// The parser remembers the last assistant message id: Claude Code streams each
// content block of one model response as its own `assistant` event.
export type ClaudeTranscript = HarnessTranscript & { lastMessageId?: string };

// Pure reducer: timestamps are supplied by the caller, not read from the clock.
export function parseClaudeEvent(
	previous: ClaudeTranscript,
	event: ClaudeStreamEvent,
	elapsedMs: number,
	stopAt: StopRule[] = []
): ClaudeTranscript {
	const next = structuredClone( previous );
	if ( event.type === 'assistant' ) {
		next.model = event.message?.model ?? next.model;
		const messageId = event.message?.id;
		if ( ! messageId || messageId !== next.lastMessageId ) next.turnDurationsMs.push( 0 );
		next.lastMessageId = messageId;
		const turn = next.turnDurationsMs.length;
		const earlier = next.turnDurationsMs.slice( 0, -1 ).reduce( ( a, b ) => a + b, 0 );
		next.turnDurationsMs[ turn - 1 ] = elapsedMs - earlier;
		for ( const block of event.message?.content ?? [] ) {
			if ( block.type === 'text' && block.text ) next.textSegments.push( block.text );
			if ( block.type !== 'tool_use' || ! block.id || ! block.name ) continue;
			const call = { id: block.id, name: block.name, input: block.input };
			if ( ! next.stoppedAt && matchesStopRule( call, stopAt ) ) {
				next.stoppedAt = { toolUseId: call.id, toolName: call.name, index: next.toolCalls.length };
			}
			next.toolCalls.push( call );
			next.toolEvents.push( {
				toolUseId: call.id,
				toolName: call.name,
				input: call.input,
				startedAtMs: elapsedMs,
				turnIndex: turn,
			} );
		}
	}
	if ( event.type === 'user' ) {
		for ( const block of event.message?.content ?? [] ) {
			if ( block.type !== 'tool_result' || ! block.tool_use_id ) continue;
			const text =
				typeof block.content === 'string'
					? block.content
					: ( block.content ?? [] ).map( ( item ) => item.text ?? '' ).join( '\n' );
			const tool = next.toolEvents.find( ( item ) => item.toolUseId === block.tool_use_id );
			const isError = block.is_error ?? false;
			if ( tool ) {
				tool.endedAtMs = elapsedMs;
				tool.durationMs = elapsedMs - tool.startedAtMs;
				tool.isError = isError;
				tool.outputChars = text.length;
			}
			next.toolResults.push( {
				toolUseId: block.tool_use_id,
				toolName: tool?.toolName ?? null,
				isError,
				text,
			} );
			if ( isError && ! next.firstToolError ) {
				next.firstToolError = {
					toolUseId: block.tool_use_id,
					toolName: tool?.toolName ?? null,
					input: tool?.input,
					error: text,
					turnIndex: tool?.turnIndex ?? 0,
				};
			}
		}
	}
	if ( event.type === 'result' ) {
		next.success = event.subtype === 'success' && ! event.is_error;
		next.stopReason = event.subtype ?? null;
		next.errorMessage = next.success ? null : event.errors?.join( '\n' ) ?? event.result ?? null;
		next.numTurns = ( next.numTurns ?? 0 ) + ( event.num_turns ?? 0 );
		const usage = event.usage;
		next.usage.input += usage?.input_tokens ?? 0;
		next.usage.output += usage?.output_tokens ?? 0;
		next.usage.cacheRead += usage?.cache_read_input_tokens ?? 0;
		next.usage.cacheWrite += usage?.cache_creation_input_tokens ?? 0;
		next.usage.totalTokens =
			next.usage.input + next.usage.output + next.usage.cacheRead + next.usage.cacheWrite;
	}
	return next;
}

export async function runClaudeConversation(
	input: HarnessInput,
	ctx: HarnessContext
): Promise< HarnessTranscript > {
	let transcript: ClaudeTranscript = emptyClaudeTranscript( input.model );
	if ( input.answers ) transcript.unsupported = [ 'answers' ];
	const sessionDir =
		process.env.STUDIO_EVAL_SESSION_DIR?.trim() || path.join( os.tmpdir(), 'studio-eval-sessions' );
	mkdirSync( sessionDir, { recursive: true } );
	transcript.sessionFile = path.join(
		mkdtempSync( path.join( sessionDir, 'claude-' ) ),
		'stream.jsonl'
	);
	const env = { ...process.env };
	delete env.CLAUDECODE;
	let sessionId: string | undefined;
	const deadline = Date.now() + ( input.timeoutMs ?? 300000 );
	const prompts = [
		`Working directory: ${ ctx.cwd }. The studio CLI is on PATH to manage local sites.\n\n${ input.prompt }`,
		...( input.followUps ?? [] ).map( ( item ) => item.prompt ),
	];
	try {
		for ( const [ index, prompt ] of prompts.entries() ) {
			if ( index > 0 && ! sessionId )
				throw new Error( 'Claude Code did not return a session_id for follow-ups' );
			// Headless runs cannot answer permission prompts; the case's sites
			// live in a temporary folder of their own.
			const args = [
				'-p',
				'--output-format',
				'stream-json',
				'--verbose',
				'--permission-mode',
				'bypassPermissions',
			];
			if ( input.model ) args.push( '--model', input.model );
			if ( sessionId ) args.push( '--resume', sessionId );
			args.push( prompt );
			await new Promise< void >( ( resolve, reject ) => {
				const child = spawn( process.env.STUDIO_EVAL_CLAUDE_BIN || 'claude', args, {
					cwd: ctx.cwd,
					env,
					stdio: [ 'ignore', 'pipe', 'pipe' ],
				} );
				let stderr = '';
				child.stderr.on( 'data', ( chunk ) => {
					stderr += String( chunk );
				} );
				const timeout = setTimeout(
					() => {
						transcript.timedOut = true;
						child.kill( 'SIGKILL' );
					},
					Math.max( 0, deadline - Date.now() )
				);
				const lines = createInterface( { input: child.stdout } );
				lines.on( 'line', ( line ) => {
					appendFileSync( transcript.sessionFile!, `${ line }\n` );
					let event: ClaudeStreamEvent;
					try {
						event = JSON.parse( line );
					} catch {
						return;
					}
					sessionId = event.session_id ?? sessionId;
					transcript = parseClaudeEvent(
						transcript,
						event,
						Date.now() - ctx.startedAt,
						input.stopAt
					);
					if ( transcript.stoppedAt ) child.kill( 'SIGKILL' );
				} );
				child.on( 'error', ( error ) => {
					clearTimeout( timeout );
					reject( error );
				} );
				child.on( 'close', ( code ) => {
					clearTimeout( timeout );
					if ( code !== 0 && ! transcript.stoppedAt && ! transcript.timedOut ) {
						reject( new Error( stderr || `Claude Code exited with code ${ code }` ) );
					} else resolve();
				} );
			} );
			if ( transcript.timedOut || transcript.stoppedAt ) break;
		}
	} catch ( error ) {
		transcript.error = error instanceof Error ? error.message : String( error );
		transcript.success = false;
	}
	if ( transcript.timedOut || transcript.stoppedAt ) transcript.success = false;
	const { lastMessageId: _lastMessageId, ...result } = transcript;
	return result;
}
