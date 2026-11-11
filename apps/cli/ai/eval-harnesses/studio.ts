import { mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SessionManager, type AgentSessionEvent } from '@earendil-works/pi-coding-agent';
import {
	addAssistantMessageUsage,
	createAgent,
	createTokenUsage,
	type AskUserHandler,
} from '@studio/agent/node';
import { findLastAssistant } from '@studio/agent/protocol/session-events';
import {
	getAiModel,
	DEFAULT_PROVIDER_ID,
	getAiModelProviders,
	getDefaultAiModel,
	isAiModelId,
	type ProviderId,
} from '@studio/providers';
import {
	resolveAiConnection,
	resolveInitialAiProvider,
	resolveUnavailableAiProvider,
} from 'cli/ai/auth';
import { matchesStopRule } from 'cli/ai/eval-stop';
import { type ModelRequestRecord } from 'cli/ai/eval-timing';
import { cliAgentHost } from 'cli/ai/host';
import { STUDIO_SITES_ROOT } from 'cli/lib/site-paths';
import type { HarnessInput, HarnessContext, HarnessTranscript } from './types';

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
	// Length of the result's text block: what the tool adds to the context.
	outputChars?: number;
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
	images?: Array< { mimeType: string; data: string } >;
	details?: unknown;
} | null {
	if ( event.type !== 'tool_execution_end' ) {
		return null;
	}
	const result = event.result as
		| {
				content?: Array< { type: string; text?: string; data?: string; mimeType?: string } >;
				details?: unknown;
		  }
		| undefined;
	let text: string | undefined;
	let images: Array< { mimeType: string; data: string } > | undefined;
	if ( result?.content && Array.isArray( result.content ) ) {
		const textBlock = result.content.find(
			( b ): b is { type: 'text'; text: string } => b.type === 'text' && typeof b.text === 'string'
		);
		if ( textBlock ) text = textBlock.text;
		const imageBlocks = result.content.filter(
			( b ): b is { type: 'image'; data: string; mimeType?: string } =>
				b.type === 'image' && typeof b.data === 'string'
		);
		if ( imageBlocks.length > 0 ) {
			images = imageBlocks.map( ( b ) => ( { mimeType: b.mimeType ?? '', data: b.data } ) );
		}
	}
	return {
		toolUseId: event.toolCallId,
		isError: event.isError,
		text,
		images,
		details: result?.details,
	};
}

export async function runStudioConversation(
	input: HarnessInput,
	ctx: HarnessContext
): Promise< HarnessTranscript > {
	const agent = createAgent( {
		host: input.ui
			? { ...cliAgentHost, ui: { showArtifact: () => {}, reloadPreview: () => {} } }
			: cliAgentHost,
	} );
	const resolvedModel =
		input.model && isAiModelId( input.model )
			? input.model
			: getDefaultAiModel( DEFAULT_PROVIDER_ID );
	const evalStartedAt = ctx.startedAt;
	const elapsed = () => Date.now() - evalStartedAt;
	const phaseTimingsMs: Record< string, number > = {};
	let phaseStartedAt = Date.now();

	let aiProvider: ProviderId = await resolveInitialAiProvider();
	phaseTimingsMs.resolve_initial_provider_ms = Date.now() - phaseStartedAt;

	phaseStartedAt = Date.now();
	aiProvider = ( await resolveUnavailableAiProvider( aiProvider ) ) ?? aiProvider;
	// The model runs on a provider that serves it.
	if ( ! getAiModel( aiProvider, resolvedModel ) ) {
		[ aiProvider ] = getAiModelProviders( resolvedModel );
	}
	phaseTimingsMs.resolve_unavailable_provider_ms = Date.now() - phaseStartedAt;

	phaseStartedAt = Date.now();
	const ai = await resolveAiConnection( aiProvider, resolvedModel );
	phaseTimingsMs.resolve_ai_environment_ms = Date.now() - phaseStartedAt;

	const toolCalls: ToolCallRecord[] = [];
	const toolResults: {
		toolUseId: string | null;
		toolName: string | null;
		isError: boolean;
		text?: string;
		images?: Array< { mimeType: string; data: string } >;
		details?: unknown;
	}[] = [];
	const toolEvents: ToolEvent[] = [];
	const requests: ModelRequestRecord[] = [];
	const textSegments: string[] = [];
	const questions: Array< { question: string; options: string[]; answer: string } > = [];
	const pendingAnswers = [ ...( input.answers ?? [] ) ];
	const onAskUser: AskUserHandler | undefined = input.answers
		? async ( asked ) =>
				Object.fromEntries(
					asked.map( ( { question, options } ) => {
						const answer = pendingAnswers.shift()?.label ?? 'Cancel';
						questions.push( {
							question,
							options: options.map( ( option ) => option.label ),
							answer,
						} );
						return [ question, answer ];
					} )
				)
		: undefined;
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
	let stoppedAt: { toolUseId: string; toolName: string; index: number } | null = null;
	// From the last assistant message: a provider failure ends the turn with
	// stopReason "error" and its message here, without throwing.
	let stopReason: string | null = null;
	let errorMessage: string | null = null;
	// Summed from each assistant message's usage, so evals can compare the
	// token cost of prompt variants, not just their outcomes.
	const usage = createTokenUsage();

	phaseStartedAt = Date.now();
	// Every run keeps its session JSONL (the full transcript) and reports its
	// path as `sessionFile`; STUDIO_EVAL_SESSION_DIR picks the directory.
	const sessionDir =
		process.env.STUDIO_EVAL_SESSION_DIR?.trim() || path.join( os.tmpdir(), 'studio-eval-sessions' );
	mkdirSync( sessionDir, { recursive: true } );
	const session = SessionManager.create( STUDIO_SITES_ROOT, sessionDir );
	const queryStartedAt = Date.now();
	let turnStart = queryStartedAt;

	const handleEvent = ( event: AgentSessionEvent ): void => {
		if ( event.type === 'message_end' && event.message.role === 'assistant' ) {
			const messageUsage = addAssistantMessageUsage( usage, event );
			const now = Date.now();
			// pi stamps the assistant message just before it sends the request.
			const requestStartedAt = event.message.timestamp || turnStart;
			requests.push( {
				startedAtMs: requestStartedAt - evalStartedAt,
				endedAtMs: now - evalStartedAt,
				durationMs: now - requestStartedAt,
				contextTokens: messageUsage
					? messageUsage.input + messageUsage.cacheRead + messageUsage.cacheWrite
					: 0,
				outputTokens: messageUsage?.output ?? 0,
				stopReason: event.message.stopReason,
				...( event.message.errorMessage ? { errorMessage: event.message.errorMessage } : {} ),
				hasText: event.message.content.some(
					( block ) => block.type === 'text' && block.text.trim() !== ''
				),
				toolCalls: event.message.content.filter( ( block ) => block.type === 'toolCall' ).length,
			} );
			turnDurationsMs.push( now - turnStart );
			turnIndex += 1;
			if ( turnIndex === 1 ) {
				phaseTimingsMs.first_assistant_message_ms = now - queryStartedAt;
			}
			turnStart = now;
		}
		for ( const tc of extractToolCalls( event ) ) {
			if ( input.stopAt && ! stoppedAt && matchesStopRule( tc, input.stopAt ) ) {
				stoppedAt = { toolUseId: tc.id, toolName: tc.name, index: toolCalls.length };
				void query.interrupt();
			}
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
					evt.outputChars = tr.text?.length ?? 0;
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
					...( tr.images ? { images: tr.images } : {} ),
					...( tr.details !== undefined ? { details: tr.details } : {} ),
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
			stopReason = lastAssistant?.stopReason ?? null;
			errorMessage = lastAssistant?.errorMessage ?? null;
		}
	};

	const runTurn = ( turnPrompt: string ) =>
		agent.runTurn( {
			prompt: turnPrompt,
			ai,
			session,
			activeSite: ctx.activeSite,
			onEvent: handleEvent,
			onAskUser,
		} );
	let query = runTurn( input.prompt );
	phaseTimingsMs.start_ai_agent_ms = Date.now() - phaseStartedAt;

	const timeout = setTimeout( () => {
		timedOut = true;
		void query.interrupt();
	}, input.timeoutMs ?? 300000 );

	try {
		await query.result;
		for ( const followUp of input.followUps ?? [] ) {
			if ( timedOut || stoppedAt ) {
				break;
			}
			query = runTurn( followUp.prompt );
			await query.result;
		}
	} catch ( caught ) {
		error = caught instanceof Error ? caught.message : String( caught );
	} finally {
		clearTimeout( timeout );
	}

	return {
		success,
		error,
		timedOut,
		stoppedAt,
		model: resolvedModel,
		numTurns: numTurnsResult,
		stopReason,
		errorMessage,
		usage,
		sessionFile: session.getSessionFile() ?? null,
		phaseTimingsMs,
		requests,
		turnDurationsMs,
		toolCalls,
		toolResults,
		toolEvents,
		firstToolError,
		textSegments,
		questions,
	};
}
