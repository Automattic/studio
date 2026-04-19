import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useConnector } from '@/data/core';
import { SESSIONS_QUERY_KEY } from '@/data/queries/use-sessions';
import type { AgentEvent, AgentRunEvent, AiSessionEvent, LoadedAiSession } from '@/data/core';

type ContentBlock =
	| { type: 'text'; text: string }
	| { type: 'tool_use'; id: string; name: string; input?: unknown }
	| { type: string; [ key: string ]: unknown };

type AssistantPayload = {
	type: 'assistant';
	message: {
		id?: string;
		role: 'assistant';
		content: ContentBlock[];
		[ key: string ]: unknown;
	};
	[ key: string ]: unknown;
};

type StreamMessageStart = {
	type: 'message_start';
	message?: { id?: string; role?: string; content?: ContentBlock[]; [ key: string ]: unknown };
};
type StreamBlockStart = {
	type: 'content_block_start';
	index: number;
	content_block: ContentBlock;
};
type StreamBlockDelta = {
	type: 'content_block_delta';
	index: number;
	delta:
		| { type: 'text_delta'; text: string }
		| { type: 'input_json_delta'; partial_json: string }
		| { type: string; [ key: string ]: unknown };
};

function nowIso(): string {
	return new Date().toISOString();
}

function asAssistantPayload( event: AiSessionEvent ): AssistantPayload | null {
	if ( event.type !== 'sdk.message' ) {
		return null;
	}
	const payload = event.message as { type?: string } | null;
	if ( ! payload || payload.type !== 'assistant' ) {
		return null;
	}
	return payload as AssistantPayload;
}

// Walk back through events looking for the most recent streaming assistant
// message in the *current* turn. Stopping at the user prompt that opened the
// turn is what prevents deltas from an out-of-order partial event from
// mutating an assistant message that has already been finalized.
function findCurrentStreamingIndex( events: AiSessionEvent[] ): number {
	for ( let i = events.length - 1; i >= 0; i-- ) {
		const event = events[ i ];
		if ( event.type === 'user.message' ) {
			return -1;
		}
		if ( asAssistantPayload( event ) ) {
			return i;
		}
	}
	return -1;
}

function applyStreamEventToEvents( events: AiSessionEvent[], rawEvent: unknown ): AiSessionEvent[] {
	const streamEvent = rawEvent as { type?: string };
	const type = streamEvent?.type;

	if ( type === 'message_start' ) {
		const msg = ( rawEvent as StreamMessageStart ).message ?? {};
		const synthetic: AssistantPayload = {
			type: 'assistant',
			message: {
				...msg,
				id: msg.id,
				role: 'assistant',
				content: [],
			},
		};
		return [ ...events, { type: 'sdk.message', timestamp: nowIso(), message: synthetic } ];
	}

	const idx = findCurrentStreamingIndex( events );
	if ( idx === -1 ) {
		return events;
	}
	const current = events[ idx ];
	const payload = asAssistantPayload( current );
	if ( ! payload ) {
		return events;
	}
	const content = [ ...payload.message.content ];

	if ( type === 'content_block_start' ) {
		const { index, content_block: block } = rawEvent as StreamBlockStart;
		content[ index ] =
			block.type === 'tool_use'
				? { ...block, input: ( block as { input?: unknown } ).input ?? {} }
				: block;
	} else if ( type === 'content_block_delta' ) {
		const { index, delta } = rawEvent as StreamBlockDelta;
		const block = content[ index ];
		if ( ! block ) {
			return events;
		}
		if ( block.type === 'text' && delta.type === 'text_delta' ) {
			const deltaText = ( delta as { text: string } ).text;
			content[ index ] = { type: 'text', text: ( block.text ?? '' ) + deltaText };
		}
	} else {
		return events;
	}

	const updated: AiSessionEvent = {
		type: 'sdk.message',
		timestamp: current.timestamp,
		message: {
			...payload,
			message: { ...payload.message, content },
		},
	};
	const next = events.slice();
	next[ idx ] = updated;
	return next;
}

function upsertFinalMessage(
	events: AiSessionEvent[],
	finalMessage: unknown,
	timestamp: string
): AiSessionEvent[] {
	const finalEvent: AiSessionEvent = {
		type: 'sdk.message',
		timestamp,
		message: finalMessage,
	};

	const msg = finalMessage as { type?: string; message?: { id?: string } } | null;
	if ( msg?.type === 'assistant' && msg.message?.id ) {
		const finalId = msg.message.id;
		for ( let i = events.length - 1; i >= 0; i-- ) {
			const ev = events[ i ];
			if ( ev.type === 'user.message' ) {
				break;
			}
			const payload = asAssistantPayload( ev );
			if ( payload && payload.message.id === finalId ) {
				const next = events.slice();
				next[ i ] = finalEvent;
				return next;
			}
		}
	}

	return [ ...events, finalEvent ];
}

interface RunState {
	runId: string;
	startedAt: number;
}

export interface LiveAgentEvents {
	runId: string | null;
	isRunning: boolean;
	startedAt: number | null;
	error: string | null;
	sendMessage: ( prompt: string ) => Promise< void >;
	interrupt: () => Promise< void >;
}

export function useAgentRun( sessionId: string | undefined ): LiveAgentEvents {
	const connector = useConnector();
	const queryClient = useQueryClient();

	const [ runState, setRunState ] = useState< RunState | null >( null );
	const [ error, setError ] = useState< string | null >( null );

	// `runState` drives `isRunning` and is cleared as soon as the agent turn
	// finishes (`turn.completed`). `subscribedRunIdRef` stays set until the
	// subprocess actually exits so trailing events for the run still match
	// the filter.
	const subscribedRunIdRef = useRef< string | null >( null );

	useEffect( () => {
		setRunState( null );
		setError( null );
		subscribedRunIdRef.current = null;
	}, [ sessionId ] );

	const updateCache = useCallback(
		( updater: ( events: AiSessionEvent[] ) => AiSessionEvent[] ) => {
			if ( ! sessionId ) {
				return;
			}
			queryClient.setQueryData< LoadedAiSession >(
				[ ...SESSIONS_QUERY_KEY, sessionId ],
				( prev ) => {
					if ( ! prev ) {
						return prev;
					}
					const events = updater( prev.events );
					return events === prev.events ? prev : { ...prev, events };
				}
			);
		},
		[ queryClient, sessionId ]
	);

	useEffect( () => {
		if ( ! sessionId ) {
			return;
		}
		const unsubscribe = connector.onAgentEvent( ( payload: AgentRunEvent ) => {
			if ( payload.sessionId !== sessionId ) {
				return;
			}
			if ( subscribedRunIdRef.current && payload.runId !== subscribedRunIdRef.current ) {
				return;
			}

			const event: AgentEvent = payload.event;

			if ( event.type === 'error' ) {
				setError( event.message );
				return;
			}

			// Hide the thinking indicator the moment the agent loop finishes —
			// the subprocess still takes time to flush recorder writes and
			// exit, but the turn itself is already over.
			if ( event.type === 'turn.completed' ) {
				setRunState( null );
				return;
			}

			if ( event.type === 'run.exited' || event.type === 'run.interrupted' ) {
				setRunState( null );
				subscribedRunIdRef.current = null;
				// Only refresh the sessions list (sidebar summaries, updatedAt).
				// The per-session cache already reflects the streamed events; a
				// refetch here would clobber any optimistic user message the
				// user just queued for the next turn.
				void queryClient.invalidateQueries( {
					queryKey: SESSIONS_QUERY_KEY,
					exact: true,
				} );
				return;
			}

			if ( event.type === 'message.delta' ) {
				updateCache( ( events ) => applyStreamEventToEvents( events, event.event ) );
				return;
			}

			if ( event.type === 'message' ) {
				updateCache( ( events ) => upsertFinalMessage( events, event.message, event.timestamp ) );
				return;
			}

			if ( event.type === 'progress' ) {
				updateCache( ( events ) => [
					...events,
					{ type: 'tool.progress', timestamp: event.timestamp, message: event.message },
				] );
				return;
			}

			if ( event.type === 'question.asked' ) {
				if ( event.questions.length === 0 ) {
					return;
				}
				updateCache( ( events ) => [
					...events,
					{
						type: 'agent.question',
						timestamp: event.timestamp,
						question: event.questions[ 0 ].question,
						options: event.questions[ 0 ].options,
					},
				] );
			}
		} );
		return unsubscribe;
	}, [ connector, queryClient, sessionId, updateCache ] );

	const sendMessage = useCallback(
		async ( prompt: string ) => {
			if ( ! sessionId ) {
				throw new Error( 'No session selected' );
			}
			setError( null );

			const optimisticEvent: AiSessionEvent = {
				type: 'user.message',
				timestamp: nowIso(),
				text: prompt,
				source: 'prompt',
			};
			updateCache( ( events ) => [ ...events, optimisticEvent ] );

			try {
				const { runId: newRunId } = await connector.continueSession( sessionId, prompt );
				setRunState( { runId: newRunId, startedAt: Date.now() } );
				subscribedRunIdRef.current = newRunId;
			} catch ( err ) {
				updateCache( ( events ) => {
					const idx = events.lastIndexOf( optimisticEvent );
					if ( idx === -1 ) {
						return events;
					}
					return [ ...events.slice( 0, idx ), ...events.slice( idx + 1 ) ];
				} );
				const message = err instanceof Error ? err.message : String( err );
				setError( message );
				throw err;
			}
		},
		[ connector, sessionId, updateCache ]
	);

	const interrupt = useCallback( async () => {
		if ( ! runState ) {
			return;
		}
		await connector.interruptAgentRun( runState.runId );
	}, [ connector, runState ] );

	return {
		runId: runState?.runId ?? null,
		isRunning: runState !== null,
		startedAt: runState?.startedAt ?? null,
		error,
		sendMessage,
		interrupt,
	};
}
