import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useReducer, useRef } from 'react';
import { useConnector } from '@/data/core';
import { SESSIONS_QUERY_KEY } from '@/data/queries/use-sessions';
import type { AgentEvent, AgentRunEvent, AiSessionEvent, LoadedAiSession } from '@/data/core';

function nowIso(): string {
	return new Date().toISOString();
}

export interface PendingQuestion {
	question: string;
	options: Array< { label: string; description: string } >;
}

export interface LiveAgentEvents {
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

// `running` → agent loop is working (thinking indicator shown).
// `winding_down` → turn completed, subprocess still draining; composer
// stays disabled so the user can't start a new turn mid-exit.
// `idle` → no active run.
type RunPhase = 'idle' | 'running' | 'winding_down';

interface State {
	phase: RunPhase;
	runId: string | null;
	startedAt: number | null;
	error: string | null;
	pendingQuestions: PendingQuestion[];
	pendingAnswers: Record< string, string >;
}

const initialState: State = {
	phase: 'idle',
	runId: null,
	startedAt: null,
	error: null,
	pendingQuestions: [],
	pendingAnswers: {},
};

type Action =
	| { type: 'reset' }
	| { type: 'send_start'; runId: string; startedAt: number }
	| { type: 'error_set'; message: string | null }
	| { type: 'turn_completed' }
	| { type: 'run_ended' }
	| { type: 'questions_added'; questions: PendingQuestion[] }
	| { type: 'question_answered'; question: string; answer: string }
	| { type: 'batch_dispatched' };

function reducer( state: State, action: Action ): State {
	switch ( action.type ) {
		case 'reset':
			return initialState;
		case 'send_start':
			return {
				...state,
				phase: 'running',
				runId: action.runId,
				startedAt: action.startedAt,
				error: null,
			};
		case 'error_set':
			return { ...state, error: action.message };
		case 'turn_completed':
			return {
				...state,
				phase: state.phase === 'idle' ? 'idle' : 'winding_down',
				pendingQuestions: [],
				pendingAnswers: {},
			};
		case 'run_ended':
			return initialState;
		case 'questions_added':
			return {
				...state,
				pendingQuestions: [ ...state.pendingQuestions, ...action.questions ],
			};
		case 'question_answered':
			return {
				...state,
				pendingAnswers: { ...state.pendingAnswers, [ action.question ]: action.answer },
			};
		case 'batch_dispatched':
			return { ...state, pendingQuestions: [], pendingAnswers: {} };
	}
}

export function useAgentRun( sessionId: string | undefined ): LiveAgentEvents {
	const connector = useConnector();
	const queryClient = useQueryClient();

	const [ state, dispatch ] = useReducer( reducer, initialState );
	const { phase, runId, startedAt, error, pendingQuestions, pendingAnswers } = state;

	// Subscribed until `run.exited` so trailing events for a run whose turn
	// has already completed still match the filter.
	const subscribedRunIdRef = useRef< string | null >( null );

	useEffect( () => {
		dispatch( { type: 'reset' } );
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

			switch ( event.type ) {
				case 'error':
					dispatch( { type: 'error_set', message: event.message } );
					return;
				case 'turn.completed':
					dispatch( { type: 'turn_completed' } );
					return;
				case 'run.exited':
				case 'run.interrupted':
					dispatch( { type: 'run_ended' } );
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
				case 'message':
					updateCache( ( events ) => [
						...events,
						{ type: 'sdk.message', timestamp: event.timestamp, message: event.message },
					] );
					return;
				case 'progress':
					updateCache( ( events ) => [
						...events,
						{ type: 'tool.progress', timestamp: event.timestamp, message: event.message },
					] );
					return;
				case 'question.asked':
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
					dispatch( { type: 'questions_added', questions: event.questions } );
					return;
			}
		} );
		return unsubscribe;
	}, [ connector, queryClient, sessionId, updateCache ] );

	const sendMessage = useCallback(
		async ( prompt: string ) => {
			if ( ! sessionId ) {
				throw new Error( 'No session selected' );
			}
			dispatch( { type: 'error_set', message: null } );

			const optimisticEvent: AiSessionEvent = {
				type: 'user.message',
				timestamp: nowIso(),
				text: prompt,
				source: 'prompt',
			};
			updateCache( ( events ) => [ ...events, optimisticEvent ] );

			try {
				const { runId: newRunId } = await connector.continueSession( sessionId, prompt );
				dispatch( { type: 'send_start', runId: newRunId, startedAt: Date.now() } );
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
				dispatch( { type: 'error_set', message } );
				throw err;
			}
		},
		[ connector, sessionId, updateCache ]
	);

	const interrupt = useCallback( async () => {
		if ( ! runId ) {
			return;
		}
		await connector.interruptAgentRun( runId );
	}, [ connector, runId ] );

	// Dispatch the batch once every question has an answer. Done inline here
	// (rather than via a useEffect watching `pendingAnswers`) because the
	// "all-answered → send" decision is a direct consequence of this click.
	const answerQuestion = useCallback(
		( question: string, answer: string ) => {
			if ( ! runId ) {
				return;
			}
			const nextAnswers = { ...pendingAnswers, [ question ]: answer };
			const complete = pendingQuestions.every(
				( q ) => typeof nextAnswers[ q.question ] === 'string'
			);
			if ( complete ) {
				dispatch( { type: 'batch_dispatched' } );
				void connector.answerAgentQuestion( runId, nextAnswers );
			} else {
				dispatch( { type: 'question_answered', question, answer } );
			}
		},
		[ connector, runId, pendingAnswers, pendingQuestions ]
	);

	return {
		isRunning: phase === 'running',
		hasActiveRun: phase !== 'idle',
		startedAt,
		error,
		pendingQuestions,
		pendingAnswers,
		sendMessage,
		interrupt,
		answerQuestion,
	};
}
