import { buildChatAttachmentSummaries } from '@studio/common/ai/chat-attachments';
import { isUsageCapError } from '@studio/common/ai/json-events';
import { useQueryClient } from '@tanstack/react-query';
import { __ } from '@wordpress/i18n';
import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useReducer,
	useRef,
	type PropsWithChildren,
} from 'react';
import { useIpcListener } from 'src/hooks/use-ipc-listener';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { SESSIONS_QUERY_KEY } from './use-session';
import type { SessionEntry } from '@earendil-works/pi-coding-agent';
import type { AgentEvent, AgentRunEvent } from '@studio/common/ai/agent-events';
import type { StudioChatFileAttachment } from '@studio/common/ai/chat-files';
import type { StudioChatImage } from '@studio/common/ai/chat-images';
import type { LoadedAiSession } from '@studio/common/ai/sessions/types';

function nowIso(): string {
	return new Date().toISOString();
}

function newId(): string {
	return `${ Date.now().toString( 36 ) }-${ Math.random().toString( 36 ).slice( 2, 10 ) }`;
}

// Optimistic entry id; the next refetch replaces it with the disk-backed one.
function shortEntryId(): string {
	return Math.random().toString( 36 ).slice( 2, 10 );
}

export interface PendingQuestion {
	question: string;
	options: Array< { label: string; description: string } >;
}

export interface QueuedPrompt {
	id: string;
	prompt: string;
	displayMessage?: string;
	images?: StudioChatImage[];
	files?: StudioChatFileAttachment[];
}

export interface SendMessageOptions {
	displayMessage?: string;
	images?: StudioChatImage[];
	files?: StudioChatFileAttachment[];
}

export interface LiveAgentEvents {
	// Agent loop is working - drives the thinking indicator. Clears at
	// `turn.completed`, before the subprocess has finished winding down.
	isRunning: boolean;
	// Subprocess is still alive - blocks starting a new turn. Clears at
	// `run.exited`/`run.interrupted`, which can lag `turn.completed` by
	// the persist-queue drain time.
	hasActiveRun: boolean;
	// User has clicked Stop and we're waiting for the child to wind down.
	// Gives the Stop button immediate "Stopping..." feedback.
	isInterrupting: boolean;
	startedAt: number | null;
	error: string | null;
	usageCapReached: boolean;
	pendingQuestions: PendingQuestion[];
	// Accumulated answers for the current batch, keyed by question text.
	// The user can re-click an option to change their pick until every
	// question is answered, at which point the batch is dispatched.
	pendingAnswers: Record< string, string >;
	// Answers that have already been dispatched, kept for the lifetime of the
	// session so the picked option stays highlighted in history. The persisted
	// `ask_user` entry only reaches the transcript after a disk refetch (which
	// lags the live run), so this in-memory map bridges that gap; on reload the
	// transcript falls back to the disk-backed answer.
	answeredQuestions: Record< string, string >;
	// Follow-up prompts the user staged while a turn was in flight. FIFO:
	// the head auto-dispatches when the current run ends.
	queuedPrompts: QueuedPrompt[];
	sendMessage: ( prompt: string, options?: SendMessageOptions ) => Promise< void >;
	interrupt: () => Promise< void >;
	answerQuestion: ( question: string, answer: string ) => void;
	removeQueuedPrompt: ( id: string ) => void;
}

// `starting` means the prompt was submitted and the subprocess run id is being created.
// `running` means the agent loop is working (thinking indicator shown).
// `winding_down` means the turn completed, but the subprocess is still draining.
// `idle` means no active run.
type RunPhase = 'idle' | 'starting' | 'running' | 'winding_down';

interface State {
	phase: RunPhase;
	runId: string | null;
	startedAt: number | null;
	error: string | null;
	usageCapReached: boolean;
	isInterrupting: boolean;
	pendingQuestions: PendingQuestion[];
	pendingAnswers: Record< string, string >;
	answeredQuestions: Record< string, string >;
	queuedPrompts: QueuedPrompt[];
}

const initialState: State = {
	phase: 'idle',
	runId: null,
	startedAt: null,
	error: null,
	usageCapReached: false,
	isInterrupting: false,
	pendingQuestions: [],
	pendingAnswers: {},
	answeredQuestions: {},
	queuedPrompts: [],
};

type Action =
	| { type: 'hydrate_active_run'; runId: string; startedAt: number; interrupting: boolean }
	| { type: 'send_pending'; startedAt: number }
	| { type: 'send_start'; runId: string; startedAt: number }
	| { type: 'error_set'; message: string | null; usageCapReached?: boolean }
	| { type: 'turn_completed' }
	| { type: 'run_ended' }
	| { type: 'interrupt_requested' }
	| { type: 'questions_added'; questions: PendingQuestion[] }
	| { type: 'question_answered'; question: string; answer: string }
	| { type: 'batch_dispatched'; answers: Record< string, string > }
	| { type: 'queue_append'; prompt: QueuedPrompt }
	| { type: 'queue_remove'; id: string }
	| { type: 'queue_shift' }
	| { type: 'queue_clear' };

function reducer( state: State, action: Action ): State {
	switch ( action.type ) {
		case 'hydrate_active_run':
			return {
				...state,
				phase: 'running',
				runId: action.runId,
				startedAt: action.startedAt,
				error: null,
				isInterrupting: action.interrupting,
			};
		case 'send_pending':
			return {
				...state,
				phase: 'starting',
				runId: null,
				startedAt: action.startedAt,
				error: null,
				isInterrupting: false,
			};
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
			return { ...state, error: action.message, usageCapReached: action.usageCapReached ?? false };
		case 'turn_completed':
			return {
				...state,
				phase: state.phase === 'idle' ? 'idle' : 'winding_down',
				pendingQuestions: [],
				pendingAnswers: {},
			};
		case 'run_ended':
			// Preserve the queue across run boundaries so staged follow-ups
			// survive the transition, and the answered-question map so picked
			// options stay highlighted in history. Everything else resets.
			return {
				...initialState,
				queuedPrompts: state.queuedPrompts,
				answeredQuestions: state.answeredQuestions,
			};
		case 'interrupt_requested':
			return {
				...state,
				phase: 'idle',
				runId: null,
				startedAt: null,
				isInterrupting: false,
				pendingQuestions: [],
				pendingAnswers: {},
			};
		case 'questions_added':
			return {
				...state,
				pendingQuestions: [ ...state.pendingQuestions, ...action.questions ],
			};
		case 'question_answered':
			// `answeredQuestions` is only written on dispatch; mid-batch the live
			// highlight comes from `pendingAnswers`.
			return {
				...state,
				pendingAnswers: { ...state.pendingAnswers, [ action.question ]: action.answer },
			};
		case 'batch_dispatched':
			return {
				...state,
				pendingQuestions: [],
				pendingAnswers: {},
				answeredQuestions: { ...state.answeredQuestions, ...action.answers },
			};
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

type StatesBySession = Record< string, State >;

type StoreAction = {
	sessionId: string;
	action: Action;
};

function storeReducer(
	state: StatesBySession,
	{ sessionId, action }: StoreAction
): StatesBySession {
	const previous = state[ sessionId ] ?? initialState;
	const next = reducer( previous, action );
	if ( next === previous ) {
		return state;
	}
	return { ...state, [ sessionId ]: next };
}

function getTimestampMs( timestamp: string ): number {
	const parsed = Date.parse( timestamp );
	return Number.isNaN( parsed ) ? Date.now() : parsed;
}

interface AgentRunStore {
	states: StatesBySession;
	dispatchSession: ( sessionId: string, action: Action ) => void;
	startRun: ( sessionId: string, prompt: string, options?: SendMessageOptions ) => Promise< void >;
	interrupt: ( sessionId: string ) => Promise< void >;
	answerQuestion: ( sessionId: string, question: string, answer: string ) => void;
}

const AgentRunContext = createContext< AgentRunStore | null >( null );

export function AgentRunProvider( { children }: PropsWithChildren ) {
	const queryClient = useQueryClient();
	const [ states, dispatch ] = useReducer( storeReducer, {} );
	const statesRef = useRef< StatesBySession >( states );
	const subscribedRunIdsBySessionRef = useRef< Map< string, string > >( new Map() );
	const ignoredRunIdsRef = useRef< Set< string > >( new Set() );
	const interruptRequestsBySessionRef = useRef< Map< string, Promise< void > > >( new Map() );
	const interruptPendingStartSessionIdsRef = useRef< Set< string > >( new Set() );

	useEffect( () => {
		statesRef.current = states;
	}, [ states ] );

	const dispatchSession = useCallback( ( sessionId: string, action: Action ) => {
		dispatch( { sessionId, action } );
	}, [] );

	const updateCache = useCallback(
		( sessionId: string, updater: ( entries: SessionEntry[] ) => SessionEntry[] ) => {
			queryClient.setQueryData< LoadedAiSession >(
				[ ...SESSIONS_QUERY_KEY, sessionId ],
				( prev ) => {
					if ( ! prev ) {
						return prev;
					}
					const current = prev.entries ?? [];
					const entries = updater( current );
					return entries === current ? prev : { ...prev, entries };
				}
			);
		},
		[ queryClient ]
	);

	useEffect( () => {
		let cancelled = false;

		void getIpcApi()
			.listActiveAiAgentRuns()
			.then( ( runs ) => {
				if ( cancelled ) {
					return;
				}
				for ( const run of runs ) {
					subscribedRunIdsBySessionRef.current.set( run.sessionId, run.runId );
					dispatchSession( run.sessionId, {
						type: 'hydrate_active_run',
						runId: run.runId,
						startedAt: run.startedAt,
						interrupting: run.phase === 'interrupting',
					} );
				}
			} )
			.catch( () => {
				// A failed snapshot should not break normal live event handling.
			} );

		return () => {
			cancelled = true;
		};
	}, [ dispatchSession ] );

	const handleAgentEvent = useCallback(
		( _event: unknown, payload: AgentRunEvent ) => {
			if ( ignoredRunIdsRef.current.has( payload.runId ) ) {
				if ( payload.event.type === 'run.exited' || payload.event.type === 'run.interrupted' ) {
					ignoredRunIdsRef.current.delete( payload.runId );
				}
				return;
			}

			const subscribedRunId = subscribedRunIdsBySessionRef.current.get( payload.sessionId );
			if ( subscribedRunId && payload.runId !== subscribedRunId ) {
				return;
			}

			const event: AgentEvent = payload.event;

			switch ( event.type ) {
				case 'run.started':
					subscribedRunIdsBySessionRef.current.set( payload.sessionId, payload.runId );
					dispatchSession( payload.sessionId, {
						type: 'hydrate_active_run',
						runId: payload.runId,
						startedAt: getTimestampMs( event.timestamp ),
						interrupting: false,
					} );
					return;
				case 'error': {
					const isUsageCap = isUsageCapError( event.message );
					const message = isUsageCap
						? __(
								'You\u2019ve reached your AI usage limit. Try again later.'
						  )
						: event.message;
					dispatchSession( payload.sessionId, {
						type: 'error_set',
						message,
						usageCapReached: isUsageCap,
					} );
					return;
				}
				case 'turn.completed':
					dispatchSession( payload.sessionId, { type: 'turn_completed' } );
					return;
				case 'run.interrupting':
					dispatchSession( payload.sessionId, { type: 'interrupt_requested' } );
					return;
				case 'run.exited':
				case 'run.interrupted':
					if ( event.type === 'run.interrupted' ) {
						// Synthetic studio.turn_closed for immediate "Interrupted
						// by you" rendering; the CLI also writes a real one.
						updateCache( payload.sessionId, ( entries ) => [
							...entries,
							{
								type: 'custom',
								id: shortEntryId(),
								parentId: null,
								timestamp: event.timestamp,
								customType: 'studio.turn_closed',
								data: { status: 'interrupted' },
							} as SessionEntry,
						] );
					}
					dispatchSession( payload.sessionId, { type: 'run_ended' } );
					subscribedRunIdsBySessionRef.current.delete( payload.sessionId );
					// Refetch to replace optimistic entries with disk-backed ones.
					void queryClient.invalidateQueries( {
						queryKey: SESSIONS_QUERY_KEY,
					} );
					return;
				case 'message': {
					// Only message-bearing pi event variants need optimistic entries.
					const inner = event.message;
					if (
						inner.type === 'message_end' &&
						( inner.message as { role?: string } ).role === 'assistant'
					) {
						updateCache( payload.sessionId, ( entries ) => [
							...entries,
							{
								type: 'message',
								id: shortEntryId(),
								parentId: null,
								timestamp: event.timestamp,
								message: inner.message,
							} as unknown as SessionEntry,
						] );
					} else if ( inner.type === 'turn_end' ) {
						const toolResults = inner.toolResults;
						if ( Array.isArray( toolResults ) && toolResults.length > 0 ) {
							updateCache( payload.sessionId, ( entries ) => [
								...entries,
								...toolResults.map(
									( tr ) =>
										( {
											type: 'message',
											id: shortEntryId(),
											parentId: null,
											timestamp: event.timestamp,
											message: tr,
										} ) as unknown as SessionEntry
								),
							] );
						}
					}
					return;
				}
				case 'progress':
					updateCache( payload.sessionId, ( entries ) => [
						...entries,
						{
							type: 'custom',
							id: shortEntryId(),
							parentId: null,
							timestamp: event.timestamp,
							customType: 'studio.tool_progress',
							data: { message: event.message },
						} as SessionEntry,
					] );
					return;
				case 'chat.artifact':
					updateCache( payload.sessionId, ( entries ) => [
						...entries,
						{
							type: 'custom',
							id: shortEntryId(),
							parentId: null,
							timestamp: event.timestamp,
							customType: 'studio.chat_artifact',
							data: event.artifact,
						} as SessionEntry,
					] );
					return;
				case 'question.asked':
					if ( event.questions.length === 0 ) return;
					updateCache( payload.sessionId, ( entries ) => [
						...entries,
						...event.questions.map(
							( q ) =>
								( {
									type: 'custom',
									id: shortEntryId(),
									parentId: null,
									timestamp: event.timestamp,
									customType: 'studio.agent_question',
									data: { question: q.question, options: q.options },
								} ) as SessionEntry
						),
					] );
					dispatchSession( payload.sessionId, {
						type: 'questions_added',
						questions: event.questions,
					} );
					return;
			}
		},
		[ dispatchSession, queryClient, updateCache ]
	);

	useIpcListener( 'ai-agent-event', handleAgentEvent );

	const startRun = useCallback(
		async ( sessionId: string, prompt: string, options: SendMessageOptions = {} ) => {
			const displayMessage = options.displayMessage ?? prompt;
			dispatchSession( sessionId, { type: 'error_set', message: null } );

			const optimisticEntry: SessionEntry = {
				type: 'custom',
				id: shortEntryId(),
				parentId: null,
				timestamp: nowIso(),
				customType: 'studio.user_prompt',
				data: {
					text: displayMessage,
					source: 'prompt',
					attachments: buildChatAttachmentSummaries( options.images, options.files ),
				},
			} as SessionEntry;
			updateCache( sessionId, ( entries ) => [ ...entries, optimisticEntry ] );
			dispatchSession( sessionId, { type: 'send_pending', startedAt: Date.now() } );

			try {
				await interruptRequestsBySessionRef.current.get( sessionId );
				const { runId: newRunId } = await getIpcApi().continueAiSession( sessionId, prompt, {
					displayMessage,
					images: options.images,
					files: options.files,
				} );
				if ( interruptPendingStartSessionIdsRef.current.has( sessionId ) ) {
					interruptPendingStartSessionIdsRef.current.delete( sessionId );
					ignoredRunIdsRef.current.add( newRunId );
					const interruptRequest = getIpcApi()
						.interruptAiAgentRun( newRunId )
						.finally( () => {
							if ( interruptRequestsBySessionRef.current.get( sessionId ) === interruptRequest ) {
								interruptRequestsBySessionRef.current.delete( sessionId );
							}
						} );
					interruptRequestsBySessionRef.current.set( sessionId, interruptRequest );
					return;
				}
				dispatchSession( sessionId, {
					type: 'send_start',
					runId: newRunId,
					startedAt: Date.now(),
				} );
				subscribedRunIdsBySessionRef.current.set( sessionId, newRunId );
			} catch ( err ) {
				updateCache( sessionId, ( entries ) => {
					const idx = entries.lastIndexOf( optimisticEntry );
					if ( idx === -1 ) return entries;
					return [ ...entries.slice( 0, idx ), ...entries.slice( idx + 1 ) ];
				} );
				const rawMessage = err instanceof Error ? err.message : String( err );
				const isUsageCap = isUsageCapError( rawMessage );
				const message = isUsageCap
					? __(
							'You\u2019ve reached your AI usage limit. Try again later or use your own Anthropic API key via the CLI (/provider).'
					  )
					: rawMessage;
				dispatchSession( sessionId, { type: 'error_set', message, usageCapReached: isUsageCap } );
				throw err;
			}
		},
		[ dispatchSession, updateCache ]
	);

	const interrupt = useCallback(
		async ( sessionId: string ) => {
			const state = statesRef.current[ sessionId ] ?? initialState;
			if ( state.phase === 'idle' ) {
				return;
			}
			const interruptedRunId = state.runId;
			if ( interruptedRunId ) {
				ignoredRunIdsRef.current.add( interruptedRunId );
			} else {
				interruptPendingStartSessionIdsRef.current.add( sessionId );
			}
			subscribedRunIdsBySessionRef.current.delete( sessionId );
			updateCache( sessionId, ( entries ) => [
				...entries,
				{
					type: 'custom',
					id: shortEntryId(),
					parentId: null,
					timestamp: nowIso(),
					customType: 'studio.turn_closed',
					data: { status: 'interrupted' },
				} as SessionEntry,
			] );
			// Optimistic feedback: the main-process `run.interrupting` event will
			// also set this, but flipping state on the click keeps the button
			// from lingering in its active style while the IPC is in flight.
			dispatchSession( sessionId, { type: 'interrupt_requested' } );
			if ( ! interruptedRunId ) {
				return;
			}
			const interruptRequest = getIpcApi()
				.interruptAiAgentRun( interruptedRunId )
				.finally( () => {
					if ( interruptRequestsBySessionRef.current.get( sessionId ) === interruptRequest ) {
						interruptRequestsBySessionRef.current.delete( sessionId );
					}
				} );
			interruptRequestsBySessionRef.current.set( sessionId, interruptRequest );
			await interruptRequest;
		},
		[ dispatchSession, updateCache ]
	);

	const answerQuestion = useCallback(
		( sessionId: string, question: string, answer: string ) => {
			const state = statesRef.current[ sessionId ] ?? initialState;
			if ( ! state.runId ) {
				return;
			}
			const nextAnswers = { ...state.pendingAnswers, [ question ]: answer };
			const complete = state.pendingQuestions.every(
				( q ) => typeof nextAnswers[ q.question ] === 'string'
			);
			if ( complete ) {
				dispatchSession( sessionId, { type: 'batch_dispatched', answers: nextAnswers } );
				void getIpcApi().answerAiAgentQuestion( state.runId, nextAnswers );
			} else {
				dispatchSession( sessionId, { type: 'question_answered', question, answer } );
			}
		},
		[ dispatchSession ]
	);

	const value = useMemo< AgentRunStore >(
		() => ( {
			states,
			dispatchSession,
			startRun,
			interrupt,
			answerQuestion,
		} ),
		[ answerQuestion, dispatchSession, interrupt, startRun, states ]
	);

	return <AgentRunContext.Provider value={ value }>{ children }</AgentRunContext.Provider>;
}

export function useAgentRun( sessionId: string | undefined ): LiveAgentEvents {
	const store = useContext( AgentRunContext );
	if ( ! store ) {
		throw new Error( 'useAgentRun must be used within AgentRunProvider' );
	}

	const {
		states,
		dispatchSession,
		startRun,
		interrupt: interruptRun,
		answerQuestion: answerRunQuestion,
	} = store;
	const state = sessionId ? states[ sessionId ] ?? initialState : initialState;
	const {
		phase,
		startedAt,
		error,
		usageCapReached,
		isInterrupting,
		pendingQuestions,
		pendingAnswers,
		answeredQuestions,
		queuedPrompts,
	} = state;

	// Re-entry guard for the queue auto-dispatch effect. The effect's deps
	// re-fire on every queue/phase change; without this guard a second render
	// between the async start-call and `send_start` could kick off a duplicate
	// run for the same queued prompt.
	const dispatchingQueuedRef = useRef( false );

	// Auto-dispatch the head of the queue once the previous run ends. On
	// success, shift; on failure, drop the whole queue so a broken backend
	// doesn't cascade errors.
	useEffect( () => {
		if ( ! sessionId || phase !== 'idle' || queuedPrompts.length === 0 ) {
			return;
		}
		if ( dispatchingQueuedRef.current ) {
			return;
		}
		const next = queuedPrompts[ 0 ];
		dispatchingQueuedRef.current = true;
		void ( async () => {
			try {
				await startRun( sessionId, next.prompt, {
					displayMessage: next.displayMessage,
					images: next.images,
					files: next.files,
				} );
				dispatchSession( sessionId, { type: 'queue_shift' } );
			} catch {
				dispatchSession( sessionId, { type: 'queue_clear' } );
			} finally {
				dispatchingQueuedRef.current = false;
			}
		} )();
	}, [ dispatchSession, phase, queuedPrompts, sessionId, startRun ] );

	const sendMessage = useCallback(
		async ( prompt: string, options: SendMessageOptions = {} ) => {
			if ( ! sessionId ) {
				throw new Error( 'No session selected' );
			}
			// Queue if anything is in flight, if we're waiting on question
			// answers, or if earlier queued prompts haven't been dispatched yet
			// (preserves FIFO order).
			if ( phase !== 'idle' || pendingQuestions.length > 0 || queuedPrompts.length > 0 ) {
				dispatchSession( sessionId, {
					type: 'queue_append',
					prompt: {
						id: newId(),
						prompt,
						displayMessage: options.displayMessage,
						images: options.images,
						files: options.files,
					},
				} );
				return;
			}
			await startRun( sessionId, prompt, options );
		},
		[ dispatchSession, phase, pendingQuestions.length, queuedPrompts.length, sessionId, startRun ]
	);

	const interrupt = useCallback( async () => {
		if ( ! sessionId ) {
			return;
		}
		await interruptRun( sessionId );
	}, [ interruptRun, sessionId ] );

	const answerQuestion = useCallback(
		( question: string, answer: string ) => {
			if ( ! sessionId ) {
				return;
			}
			answerRunQuestion( sessionId, question, answer );
		},
		[ answerRunQuestion, sessionId ]
	);

	const removeQueuedPrompt = useCallback(
		( id: string ) => {
			if ( ! sessionId ) {
				return;
			}
			dispatchSession( sessionId, { type: 'queue_remove', id } );
		},
		[ dispatchSession, sessionId ]
	);

	return {
		isRunning: phase === 'starting' || phase === 'running',
		hasActiveRun: phase !== 'idle',
		isInterrupting,
		startedAt,
		error,
		usageCapReached,
		pendingQuestions,
		pendingAnswers,
		answeredQuestions,
		queuedPrompts,
		sendMessage,
		interrupt,
		answerQuestion,
		removeQueuedPrompt,
	};
}
