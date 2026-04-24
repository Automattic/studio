/**
 * PromptFoo eval runner for Studio Code agent.
 *
 * Hooks into startAiAgent() to capture tool calls, tool results, assistant text,
 * and permission questions. Returns raw structured data — assertions live in the
 * promptfoo config, not here.
 */

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

async function runEval( input: EvalRunnerInput ) {
	const policy = input.askUserPolicy ?? 'deny_permissions_allow_other';

	// Build environment for the agent subprocess.
	// If ANTHROPIC_API_KEY is already set (e.g. CI), use it directly.
	// Otherwise resolve via Studio's provider system (WP.com auth or saved API key).
	const env = { ...( process.env as Record< string, string > ) };
	if ( ! env.ANTHROPIC_API_KEY ) {
		let aiProvider: AiProviderId = await resolveInitialAiProvider();
		aiProvider = ( await resolveUnavailableAiProvider( aiProvider ) ) ?? aiProvider;
		Object.assign( env, await resolveAiEnvironment( aiProvider ) );
	}
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
			for ( const tc of extractToolCalls( message ) ) {
				toolCalls.push( tc );
				toolNameById.set( tc.id, tc.name );
			}
			textSegments.push( ...extractTextSegments( message ) );

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

	return { success, numTurns, toolCalls, toolResults, textSegments, questions };
}

async function main() {
	try {
		const result = await runEval( readInput() );
		process.stdout.write( JSON.stringify( result ) );
	} catch ( error ) {
		process.stdout.write(
			JSON.stringify( {
				success: false,
				error: error instanceof Error ? error.message : String( error ),
			} )
		);
		process.exitCode = 1;
	}
}

void main();
