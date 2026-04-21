import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useReducer, useRef } from 'react';
import { useConnector } from '@/data/core';
import { SESSIONS_QUERY_KEY } from '@/data/queries/use-sessions';
import type { AgentEvent, AgentRunEvent, AiSessionEvent, LoadedAiSession } from '@/data/core';

function nowIso(): string {
	return new Date().toISOString();
}

function newId(): string {
	return `${ Date.now().toString( 36 ) }-${ Math.random().toString( 36 ).slice( 2, 10 ) }`;
}

export interface PendingQuestion {
	question: string;
	options: Array< { label: string; description: string } >;
}

export interface QueuedPrompt {
	id: string;
	prompt: string;
}

export interface LiveAgentEvents {
	// Agent loop is working — drives the thinking indicator. Clears at
	// `turn.completed`, before the subprocess has finished winding down.
	isRunning: boolean;
	// Subprocess is still alive — blocks starting a new turn. Clears at
	// `run.exited`/`run.interrupted`, which can lag `turn.completed` by
	// the persist-queue drain time.
	hasActiveRun: boolean;
	// User has clicked Stop and we're waiting for the child to wind down.
	// Gives the Stop button immediate "Stopping…" feedback.
	isInterrupting: boolean;
	startedAt: number | null;
	error: string | null;
	pendingQuestions: PendingQuestion[];
	// Accumulated answers for the current batch, keyed by question text.
	// The user can re-click an option to change their pick until every
	// question is answered, at which point the batch is dispatched.
	pendingAnswers: Record< string, string >;
	// Follow-up prompts the user staged while a turn was in flight. FIFO:
	// the head auto-dispatches when the current run ends.
	queuedPrompts: QueuedPrompt[];
	sendMessage: ( prompt: string ) => Promise< void >;
	interrupt: () => Promise< void >;
	answerQuestion: ( question: string, answer: string ) => void;
	removeQueuedPrompt: ( id: string ) => void;
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
	isInterrupting: boolean;
	pendingQuestions: PendingQuestion[];
	pendingAnswers: Record< string, string >;
	queuedPrompts: QueuedPrompt[];
}

const initialState: State = {
	phase: 'idle',
	runId: null,
	startedAt: null,
	error: null,
	isInterrupting: false,
	pendingQuestions: [],
	pendingAnswers: {},
	queuedPrompts: [],
};

type Action =
	| { type: 'reset' }
	| { type: 'send_start'; runId: string; startedAt: number }
	| { type: 'error_set'; message: string | null }
	| { type: 'turn_completed' }
	| { type: 'run_ended' }
	| { type: 'interrupt_requested' }
	| { type: 'questions_added'; questions: PendingQuestion[] }
	| { type: 'question_answered'; question: string; answer: string }
	| { type: 'batch_dispatched' }
	| { type: 'queue_append'; prompt: QueuedPrompt }
	| { type: 'queue_remove'; id: string }
	| { type: 'queue_shift' }
	| { type: 'queue_clear' };

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
				isInterrupting: false,
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
			// Preserve the queue across run boundaries so staged follow-ups
			// survive the transition. Everything else resets.
			return { ...initialState, queuedPrompts: state.queuedPrompts };
		case 'interrupt_requested':
			return { ...state, isInterrupting: true };
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
		case 'queue_append':
			return { ...state, queuedPrompts: [ ...state.queuedPrompts, action.prompt ] };
		case 'queue_remove':
			return {
				...state,
				queuedPrompts: state.queuedPrompts.filter( ( q ) => q.id !== action.id ),
			};
		case 'queue_shift':
			return { ...state, queuedPrompts: state.queuedPrompts.slice( 1 ) };
		case 'queue_clear':
			return { ...state, queuedPrompts: [] };
	}
}

export function useAgentRun( sessionId: string | undefined ): LiveAgentEvents {
	const connector = useConnector();
	const queryClient = useQueryClient();

	const [ state, dispatch ] = useReducer( reducer, initialState );
	const {
		phase,
		runId,
		startedAt,
		error,
		isInterrupting,
		pendingQuestions,
		pendingAnswers,
		queuedPrompts,
	} = state;

	// Subscribed until `run.exited` so trailing events for a run whose turn
	// has already completed still match the filter.
	const subscribedRunIdRef = useRef< string | null >( null );
	// Re-entry guard for the queue auto-dispatch effect. The effect's deps
	// re-fire on every queue/phase change; without this guard a second render
	// between the async start-call and `send_start` could kick off a duplicate
	// run for the same queued prompt.
	const dispatchingQueuedRef = useRef( false );

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
				case 'run.interrupting':
					dispatch( { type: 'interrupt_requested' } );
					return;
				case 'run.exited':
				case 'run.interrupted':
					if ( event.type === 'run.interrupted' ) {
						// Append a synthetic `turn.closed` so the conversation view
						// renders the "Interrupted by you" marker immediately. The
						// CLI also persists a real `turn.closed` to the session file,
						// so the marker survives a reload.
						updateCache( ( events ) => [
							...events,
							{
								type: 'turn.closed',
								timestamp: event.timestamp,
								status: 'interrupted',
							},
						] );
					}
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

	// Core "start a new turn" path. Shared by direct sends (`sendMessage` when
	// idle) and the queue auto-dispatch effect. Throws on error so the direct
	// caller can restore the composer draft; the queue path catches and clears.
	const startRun = useCallback(
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

	// Auto-dispatch the head of the queue once the previous run ends. On
	// success, shift; on failure, drop the whole queue so a broken backend
	// doesn't cascade errors.
	useEffect( () => {
		if ( phase !== 'idle' || queuedPrompts.length === 0 ) {
			return;
		}
		if ( dispatchingQueuedRef.current ) {
			return;
		}
		const next = queuedPrompts[ 0 ];
		dispatchingQueuedRef.current = true;
		void ( async () => {
			try {
				await startRun( next.prompt );
				dispatch( { type: 'queue_shift' } );
			} catch {
				dispatch( { type: 'queue_clear' } );
			} finally {
				dispatchingQueuedRef.current = false;
			}
		} )();
	}, [ phase, queuedPrompts, startRun ] );

	const sendMessage = useCallback(
		async ( prompt: string ) => {
			// Queue if anything is in flight, if we're waiting on question
			// answers, or if earlier queued prompts haven't been dispatched yet
			// (preserves FIFO order).
			if ( phase !== 'idle' || pendingQuestions.length > 0 || queuedPrompts.length > 0 ) {
				dispatch( { type: 'queue_append', prompt: { id: newId(), prompt } } );
				return;
			}
			await startRun( prompt );
		},
		[ phase, pendingQuestions.length, queuedPrompts.length, startRun ]
	);

	const interrupt = useCallback( async () => {
		if ( ! runId ) {
			return;
		}
		// Optimistic feedback: the main-process `run.interrupting` event will
		// also set this, but flipping state on the click keeps the button
		// from lingering in its active style while the IPC is in flight.
		dispatch( { type: 'interrupt_requested' } );
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

	const removeQueuedPrompt = useCallback( ( id: string ) => {
		dispatch( { type: 'queue_remove', id } );
	}, [] );

	return {
		isRunning: phase === 'running',
		hasActiveRun: phase !== 'idle',
		isInterrupting,
		startedAt,
		error,
		pendingQuestions,
		pendingAnswers,
		queuedPrompts,
		sendMessage,
		interrupt,
		answerQuestion,
		removeQueuedPrompt,
	};
}
