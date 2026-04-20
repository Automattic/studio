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

export interface PendingQuestion {
	question: string;
	options: Array< { label: string; description: string } >;
}

export interface LiveAgentEvents {
	runId: string | null;
	// Agent loop is working — drives the thinking indicator. Clears at
	// `turn.completed`, before the subprocess has finished winding down.
	isRunning: boolean;
	// Subprocess is still alive — blocks starting a new turn. Clears at
	// `run.exited`/`run.interrupted`, which can lag `turn.completed` by
	// the persist-queue drain time.
	hasActiveRun: boolean;
	startedAt: number | null;
	error: string | null;
	pendingQuestions: PendingQuestion[];
	// Accumulated answers for the current batch, keyed by question text.
	// The user can re-click an option to change their pick until every
	// question is answered, at which point the batch is dispatched.
	pendingAnswers: Record< string, string >;
	sendMessage: ( prompt: string ) => Promise< void >;
	interrupt: () => Promise< void >;
	answerQuestion: ( question: string, answer: string ) => void;
}

export function useAgentRun( sessionId: string | undefined ): LiveAgentEvents {
	const connector = useConnector();
	const queryClient = useQueryClient();

	const [ runState, setRunState ] = useState< RunState | null >( null );
	const [ isTurnActive, setIsTurnActive ] = useState( false );
	const [ error, setError ] = useState< string | null >( null );
	const [ pendingQuestions, setPendingQuestions ] = useState< PendingQuestion[] >( [] );
	const [ pendingAnswers, setPendingAnswers ] = useState< Record< string, string > >( {} );

	// Subscribed until `run.exited` so trailing events for a run whose turn
	// has already completed still match the filter.
	const subscribedRunIdRef = useRef< string | null >( null );

	useEffect( () => {
		setRunState( null );
		setIsTurnActive( false );
		setError( null );
		setPendingQuestions( [] );
		setPendingAnswers( {} );
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

			// Hide the thinking indicator the moment the agent loop finishes.
			// The composer stays disabled until `run.exited` because the
			// subprocess is still winding down and can't accept a new turn.
			if ( event.type === 'turn.completed' ) {
				setIsTurnActive( false );
				setPendingQuestions( [] );
				setPendingAnswers( {} );
				return;
			}

			if ( event.type === 'run.exited' || event.type === 'run.interrupted' ) {
				setRunState( null );
				setIsTurnActive( false );
				setPendingQuestions( [] );
				setPendingAnswers( {} );
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
					...event.questions.map( ( q ) => ( {
						type: 'agent.question' as const,
						timestamp: event.timestamp,
						question: q.question,
						options: q.options,
					} ) ),
				] );
				setPendingQuestions( ( prev ) => [ ...prev, ...event.questions ] );
			}
		} );
		return unsubscribe;
	}, [ connector, queryClient, sessionId, updateCache ] );

	// Dispatch the collected answer map once every question in the current
	// batch has been answered. The user can change a pick at any time before
	// the batch is complete; keeping the "all-answered → send" decision here
	// (rather than in `answerQuestion`) avoids races between the two setters.
	useEffect( () => {
		if ( ! runState ) {
			return;
		}
		if ( pendingQuestions.length === 0 ) {
			return;
		}
		const complete = pendingQuestions.every(
			( q ) => typeof pendingAnswers[ q.question ] === 'string'
		);
		if ( ! complete ) {
			return;
		}
		const answers = pendingAnswers;
		setPendingQuestions( [] );
		setPendingAnswers( {} );
		void connector.answerAgentQuestion( runState.runId, answers );
	}, [ pendingAnswers, connector, pendingQuestions, runState ] );

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
				setIsTurnActive( true );
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

	const answerQuestion = useCallback( ( question: string, answer: string ) => {
		setPendingAnswers( ( prev ) => ( { ...prev, [ question ]: answer } ) );
	}, [] );

	return {
		runId: runState?.runId ?? null,
		isRunning: isTurnActive,
		hasActiveRun: runState !== null,
		startedAt: runState?.startedAt ?? null,
		error,
		pendingQuestions,
		pendingAnswers,
		sendMessage,
		interrupt,
		answerQuestion,
	};
}
