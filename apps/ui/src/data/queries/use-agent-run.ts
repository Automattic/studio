import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useConnector } from '@/data/core';
import { SESSIONS_QUERY_KEY } from '@/data/queries/use-sessions';
import type { AgentEvent, AgentRunEvent, AiSessionEvent, LoadedAiSession } from '@/data/core';

function nowIso(): string {
	return new Date().toISOString();
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

			if ( event.type === 'message' ) {
				const finalEvent: AiSessionEvent = {
					type: 'sdk.message',
					timestamp: event.timestamp,
					message: event.message,
				};
				updateCache( ( events ) => [ ...events, finalEvent ] );
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
