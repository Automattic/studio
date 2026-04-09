/**
 * PromptFoo eval runner for Studio Code agent.
 *
 * Integrates directly with startAiAgent() to capture tool calls, tool results,
 * assistant text, and permission questions as structured data for assertions.
 *
 * Based on Julien Verneaut's evaluation design.
 *
 * Usage: npx tsx eval/runner.ts
 * Input: JSON on stdin with { prompt, maxTurns?, askUserPolicy?, answerMap?, timeoutMs? }
 * Output: JSON on stdout with structured agent execution data
 */

import { readFileSync } from 'fs';
import { startAiAgent, type AskUserQuestion } from 'cli/ai/agent';
import {
	resolveAiEnvironment,
	resolveInitialAiProvider,
	resolveUnavailableAiProvider,
} from 'cli/ai/auth';
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import type { AiProviderId } from 'cli/ai/providers';

// --- Types ---

interface EvalRunnerInput {
	prompt: string;
	maxTurns?: number;
	timeoutMs?: number;
	askUserPolicy?: 'allow_all' | 'first_option' | 'deny_permissions_allow_other';
	answerMap?: Record< string, string >;
	aiProvider?: string;
}

interface AgentToolCall {
	id: string;
	name: string;
	normalizedName: string;
	input: unknown;
}

interface AgentToolResult {
	toolUseId: string | null;
	toolName: string | null;
	normalizedToolName: string | null;
	isError: boolean;
	text?: string;
}

interface AskedQuestion {
	question: string;
	options: string[];
	answer: string;
	isPermissionQuestion: boolean;
}

// --- Helpers ---

function normalizeStudioToolName( name: string ): string {
	return name.replace( /^mcp__studio__/, '' );
}

function isPermissionQuestion( question: string ): boolean {
	const lower = question.toLowerCase();
	return (
		lower.includes( 'permission' ) ||
		lower.includes( 'approve' ) ||
		lower.includes( 'allow' ) ||
		lower.includes( 'outside' )
	);
}

function pickQuestionAnswer( opts: {
	question: string;
	options: string[];
	askUserPolicy: string;
	answerMap: Record< string, string >;
} ): string {
	for ( const [ key, value ] of Object.entries( opts.answerMap ) ) {
		if ( opts.question.toLowerCase().includes( key.toLowerCase() ) ) {
			return value;
		}
	}

	if ( opts.askUserPolicy === 'allow_all' || opts.askUserPolicy === 'first_option' ) {
		return opts.options[ 0 ] ?? 'yes';
	}

	if ( isPermissionQuestion( opts.question ) ) {
		const denyOption = opts.options.find( ( o ) => /\b(no|deny|reject|cancel)\b/i.test( o ) );
		return denyOption ?? opts.options[ opts.options.length - 1 ] ?? 'no';
	}
	return opts.options[ 0 ] ?? 'yes';
}

function extractAssistantToolCalls( message: SDKMessage ): AgentToolCall[] {
	if ( message.type !== 'assistant' ) {
		return [];
	}
	return ( message.message.content ?? [] )
		.filter(
			( block ): block is { type: 'tool_use'; id: string; name: string; input: unknown } =>
				block.type === 'tool_use'
		)
		.map( ( block ) => ( {
			id: block.id,
			name: block.name,
			normalizedName: normalizeStudioToolName( block.name ),
			input: block.input,
		} ) );
}

function extractAssistantTextSegments( message: SDKMessage ): string[] {
	if ( message.type !== 'assistant' ) {
		return [];
	}
	return ( message.message.content ?? [] )
		.filter( ( block ): block is { type: 'text'; text: string } => block.type === 'text' )
		.map( ( block ) => block.text );
}

function extractToolResultFromUserMessage(
	message: SDKMessage
): { toolUseId: string | null; isError: boolean; text?: string } | null {
	if ( message.type !== 'user' ) {
		return null;
	}
	const content = message.message.content;
	if ( ! Array.isArray( content ) ) {
		return null;
	}
	const resultBlock = content.find(
		(
			block
		): block is {
			type: 'tool_result';
			tool_use_id: string;
			is_error?: boolean;
			content?: unknown;
		} => block.type === 'tool_result'
	);
	if ( ! resultBlock ) {
		return null;
	}
	let text: string | undefined;
	if ( typeof resultBlock.content === 'string' ) {
		text = resultBlock.content;
	} else if ( Array.isArray( resultBlock.content ) ) {
		const textBlock = resultBlock.content.find(
			( b: { type: string; text?: string } ) => b.type === 'text'
		);
		if ( textBlock && 'text' in textBlock ) {
			text = textBlock.text as string;
		}
	}
	return {
		toolUseId: resultBlock.tool_use_id ?? null,
		isError: resultBlock.is_error === true,
		text,
	};
}

function getErrorMessage( error: unknown ): string {
	return error instanceof Error ? error.message : String( error );
}

function ensureNodeOnPath( existingPath?: string ): string {
	const nodeBin = process.execPath.replace( /\/node$/, '' );
	if ( existingPath?.includes( nodeBin ) ) {
		return existingPath;
	}
	return existingPath ? `${ nodeBin }:${ existingPath }` : nodeBin;
}

// --- Structured checks ---

function buildSiteCreateCheck( context: {
	toolCalls: AgentToolCall[];
	toolResultsById: Map< string, AgentToolResult >;
} ): { called: boolean; succeeded: boolean | null; siteName: string | null } {
	const call = context.toolCalls.find( ( c ) => c.normalizedName === 'site_create' );
	if ( ! call ) {
		return { called: false, succeeded: null, siteName: null };
	}
	const result = context.toolResultsById.get( call.id );
	return {
		called: true,
		succeeded: result ? ! result.isError : null,
		siteName: ( call.input as { name?: string } )?.name ?? null,
	};
}

function buildValidateBlocksCheck( context: {
	toolCalls: AgentToolCall[];
	toolResultsById: Map< string, AgentToolResult >;
} ): {
	called: boolean;
	invalidBlocks: number | null;
	coreHtmlBlocks: number | null;
} {
	const call = context.toolCalls.find( ( c ) => c.normalizedName === 'validate_blocks' );
	if ( ! call ) {
		return { called: false, invalidBlocks: null, coreHtmlBlocks: null };
	}
	const result = context.toolResultsById.get( call.id );
	let invalidBlocks: number | null = null;
	let coreHtmlBlocks: number | null = null;

	if ( result?.text ) {
		const validMatch = result.text.match( /(\d+)\/(\d+) blocks valid/ );
		if ( validMatch ) {
			const total = parseInt( validMatch[ 2 ], 10 );
			const valid = parseInt( validMatch[ 1 ], 10 );
			invalidBlocks = total - valid;
		}
		const htmlMatch = result.text.match( /core\/html/g );
		coreHtmlBlocks = htmlMatch ? htmlMatch.length : 0;
	}

	return { called: true, invalidBlocks, coreHtmlBlocks };
}

// --- Main ---

function readInput(): EvalRunnerInput {
	const raw = readFileSync( '/dev/stdin', 'utf-8' );
	return JSON.parse( raw ) as EvalRunnerInput;
}

async function runAgentEval( input: EvalRunnerInput ) {
	const prompt = input.prompt.trim();

	const askUserPolicy = input.askUserPolicy ?? 'deny_permissions_allow_other';
	const answerMap = input.answerMap ?? {};

	let aiProvider: AiProviderId =
		( input.aiProvider as AiProviderId ) ?? ( await resolveInitialAiProvider() );
	aiProvider = ( await resolveUnavailableAiProvider( aiProvider ) ) ?? aiProvider;

	const providerEnvironment = await resolveAiEnvironment( aiProvider );
	const env = {
		...( process.env as Record< string, string > ),
		...providerEnvironment,
		PATH: ensureNodeOnPath( process.env.PATH ),
	};
	// Allow running inside a Claude Code session (e.g. during development)
	delete env.CLAUDECODE;

	// Agent facts
	const toolCalls: AgentToolCall[] = [];
	const toolResults: AgentToolResult[] = [];
	const assistantTextSegments: string[] = [];
	const askedQuestions: AskedQuestion[] = [];
	const toolNameByUseId = new Map< string, string >();
	let numTurns: number | null = null;
	let success = false;

	const agentQuery = startAiAgent( {
		prompt,
		env,
		maxTurns: input.maxTurns ?? 50,
		onAskUser: async ( questions: AskUserQuestion[] ) => {
			const answers: Record< string, string > = {};
			for ( const question of questions ) {
				const options = question.options.map( ( option ) => option.label );
				const answer = pickQuestionAnswer( {
					question: question.question,
					options,
					askUserPolicy,
					answerMap,
				} );
				answers[ question.question ] = answer;
				askedQuestions.push( {
					question: question.question,
					options,
					answer,
					isPermissionQuestion: isPermissionQuestion( question.question ),
				} );
			}
			return answers;
		},
	} );

	const timeout = setTimeout( () => void agentQuery.interrupt(), input.timeoutMs ?? 300000 );

	try {
		for await ( const message of agentQuery ) {
			for ( const toolCall of extractAssistantToolCalls( message ) ) {
				toolCalls.push( toolCall );
				toolNameByUseId.set( toolCall.id, toolCall.name );
			}
			assistantTextSegments.push( ...extractAssistantTextSegments( message ) );

			if ( message.type === 'user' ) {
				const toolResult = extractToolResultFromUserMessage( message );
				if ( toolResult ) {
					const toolUseId = toolResult.toolUseId ?? message.parent_tool_use_id ?? null;
					const toolName = toolUseId ? toolNameByUseId.get( toolUseId ) ?? null : null;
					toolResults.push( {
						toolUseId,
						toolName,
						normalizedToolName: toolName ? normalizeStudioToolName( toolName ) : null,
						isError: toolResult.isError,
						...( toolResult.text ? { text: toolResult.text } : {} ),
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

	const toolResultsById = new Map< string, AgentToolResult >();
	for ( const result of toolResults ) {
		if ( result.toolUseId ) {
			toolResultsById.set( result.toolUseId, result );
		}
	}

	return {
		mode: 'agent' as const,
		success,
		numTurns,
		questions: {
			all: askedQuestions,
			permission: askedQuestions.filter( ( q ) => q.isPermissionQuestion ),
		},
		tools: {
			called: toolCalls.map( ( c ) => c.normalizedName ),
			calledUnique: Array.from( new Set( toolCalls.map( ( c ) => c.normalizedName ) ) ),
		},
		assistant: {
			combinedText: assistantTextSegments.join( '\n\n' ),
		},
		checks: {
			siteCreate: buildSiteCreateCheck( { toolCalls, toolResultsById } ),
			validateBlocks: buildValidateBlocksCheck( { toolCalls, toolResultsById } ),
		},
	};
}

async function main() {
	try {
		const input = readInput();
		const result = await runAgentEval( input );
		process.stdout.write( JSON.stringify( result ) );
	} catch ( error ) {
		process.stdout.write(
			JSON.stringify( {
				mode: 'runner_error',
				success: false,
				error: getErrorMessage( error ),
			} )
		);
		process.exitCode = 1;
	}
}

void main();
