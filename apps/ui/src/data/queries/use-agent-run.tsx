import { buildChatAttachmentSummaries } from '@studio/common/ai/chat-attachments';
import { getAgentEndFailure } from '@studio/common/ai/json-events';
import { getEffectiveSessionProvider } from '@studio/common/ai/providers';
import { getStudioToolProgress } from '@studio/common/ai/tool-progress';
import { STOPPED_WITHOUT_ANSWER } from '@studio/common/ai/tools';
import { useQueryClient } from '@tanstack/react-query';
import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
	useSyncExternalStore,
	type PropsWithChildren,
} from 'react';
import { toast } from '@/data/app-messages';
import { useConnector } from '@/data/core';
import { useAiSettings } from '@/data/queries/use-ai-settings';
import { ASSISTANT_QUOTA_QUERY_KEY } from '@/data/queries/use-assistant-quota';
import { SESSIONS_QUERY_KEY, useSession } from '@/data/queries/use-sessions';
import { useIsOutOfAiCredits } from '@/hooks/use-is-out-of-ai-credits';
import type {
	AgentEvent,
	AgentRunEvent,
	LoadedAiSession,
	SessionEntry,
	StudioChatFileAttachment,
	StudioChatImage,
	StudioCustomEntry,
	StudioVisualAnnotationSummary,
} from '@/data/core';
import type { ActiveAgentRun } from '@studio/common/ai/agent-events';

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

interface PendingQuestion {
	question: string;
	options: Array< { label: string; description: string; image?: string } >;
}

export interface QueuedPrompt {
	id: string;
	prompt: string;
	displayMessage?: string;
	images?: StudioChatImage[];
	files?: StudioChatFileAttachment[];
	visualAnnotations?: StudioVisualAnnotationSummary[];
}

interface SendMessageOptions {
	displayMessage?: string;
	images?: StudioChatImage[];
	files?: StudioChatFileAttachment[];
	visualAnnotations?: StudioVisualAnnotationSummary[];
}

interface LiveAgentEvents {
	// Agent loop is working - drives the thinking indicator. Clears at
	// `turn.completed`, before the subprocess has finished winding down.
	isRunning: boolean;
	// Subprocess is still alive - blocks starting a new turn. Clears at
	// `run.exited`/`run.interrupted`, which can lag `turn.completed` by
	// the persist-queue drain time.
	hasActiveRun: boolean;
	// User has clicked Stop and we're waiting for the child to wind down. A
	// second Stop force-kills it; new messages queue until it exits.
	isInterrupting: boolean;
	startedAt: number | null;
	pendingQuestions: PendingQuestion[];
	// Accumulated answers for the current batch, keyed by question text.
	// The user can re-click an option to change their pick until every
	// question is answered, at which point the batch is dispatched.
	pendingAnswers: Record< string, string >;
	// Follow-up prompts the user staged while a turn was in flight. FIFO:
	// the head auto-dispatches when the current run ends.
	queuedPrompts: QueuedPrompt[];
	sendMessage: ( prompt: string, options?: SendMessageOptions ) => Promise< void >;
	interrupt: () => Promise< void >;
	answerQuestion: ( question: string, answer: string ) => void;
	clearQuestionAnswer: ( question: string ) => void;
	removeQueuedPrompt: ( id: string ) => void;
}

// `starting` means the prompt was submitted and the subprocess run id is being created.
// `running` means the agent loop is working (thinking indicator shown).
// `winding_down` means the turn completed, but the subprocess is still draining.
// `idle` means no active run.
type RunPhase = 'idle' | 'starting' | 'running' | 'winding_down';
export type SiteAgentActivity = 'idle' | 'working' | 'pending-question';

interface State {
	phase: RunPhase;
	runId: string | null;
	startedAt: number | null;
	isInterrupting: boolean;
	pendingQuestions: PendingQuestion[];
	pendingAnswers: Record< string, string >;
	queuedPrompts: QueuedPrompt[];
}

const initialState: State = {
	phase: 'idle',
	runId: null,
	startedAt: null,
	isInterrupting: false,
	pendingQuestions: [],
	pendingAnswers: {},
	queuedPrompts: [],
};

type Action =
	| {
			type: 'hydrate_active_run';
			runId: string;
			startedAt: number;
			interrupting: boolean;
			pendingQuestions?: PendingQuestion[];
	  }
	| { type: 'send_pending'; startedAt: number }
	| { type: 'send_start'; runId: string; startedAt: number }
	| { type: 'turn_completed' }
	| { type: 'run_ended' }
	| { type: 'interrupt_requested' }
	| { type: 'questions_added'; questions: PendingQuestion[] }
	| { type: 'question_answered'; question: string; answer: string }
	| { type: 'question_answer_cleared'; question: string }
	| { type: 'batch_dispatched' }
	| { type: 'queue_append'; prompt: QueuedPrompt }
	| { type: 'queue_remove'; id: string }
	| { type: 'queue_shift' }
	| { type: 'queue_clear' };

function resolveRunStartedAt( state: State, runId: string, startedAt: number ): number {
	if ( state.phase === 'starting' || state.runId === runId ) {
		return state.startedAt ?? startedAt;
	}
	return startedAt;
}

function reducer( state: State, action: Action ): State {
	switch ( action.type ) {
		case 'hydrate_active_run':
			return {
				...state,
				phase:
					action.interrupting || ( state.runId === action.runId && state.phase === 'winding_down' )
						? 'winding_down'
						: 'running',
				runId: action.runId,
				startedAt: resolveRunStartedAt( state, action.runId, action.startedAt ),
				isInterrupting: action.interrupting,
				pendingQuestions: action.pendingQuestions?.length
					? action.pendingQuestions
					: state.pendingQuestions,
			};
		case 'send_pending':
			return {
				...state,
				phase: 'starting',
				runId: null,
				startedAt: action.startedAt,
				isInterrupting: false,
			};
		case 'send_start':
			return {
				...state,
				phase: 'running',
				runId: action.runId,
				startedAt: resolveRunStartedAt( state, action.runId, action.startedAt ),
				isInterrupting: false,
			};
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
			return {
				...initialState,
				queuedPrompts: state.queuedPrompts,
			};
		case 'interrupt_requested':
			return {
				...state,
				phase: 'winding_down',
				isInterrupting: true,
				pendingQuestions: [],
				pendingAnswers: {},
			};
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
		case 'question_answer_cleared': {
			const { [ action.question ]: _cleared, ...rest } = state.pendingAnswers;
			return { ...state, pendingAnswers: rest };
		}
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

// External store instead of useReducer state so per-session hooks can
// subscribe with `useSyncExternalStore` and re-render only when their own
// session's slice changes — a streaming tick for one session must not
// re-render every sidebar row.
interface SessionStateStore {
	getState: () => StatesBySession;
	dispatch: ( action: StoreAction ) => void;
	subscribe: ( listener: () => void ) => () => void;
}

function createSessionStateStore(): SessionStateStore {
	let state: StatesBySession = {};
	const listeners = new Set< () => void >();
	return {
		getState: () => state,
		dispatch: ( action ) => {
			const next = storeReducer( state, action );
			if ( next === state ) {
				return;
			}
			state = next;
			listeners.forEach( ( listener ) => listener() );
		},
		subscribe: ( listener ) => {
			listeners.add( listener );
			return () => {
				listeners.delete( listener );
			};
		},
	};
}

interface AgentRunStore {
	stateStore: SessionStateStore;
	dispatchSession: ( sessionId: string, action: Action ) => void;
	startRun: ( sessionId: string, prompt: string, options?: SendMessageOptions ) => Promise< void >;
	interrupt: ( sessionId: string ) => Promise< void >;
	answerQuestion: ( sessionId: string, question: string, answer: string ) => void;
	clearQuestionAnswer: ( sessionId: string, question: string ) => void;
}

const AgentRunContext = createContext< AgentRunStore | null >( null );

export function AgentRunProvider( { children }: PropsWithChildren ) {
	const connector = useConnector();
	const queryClient = useQueryClient();
	const [ stateStore ] = useState( createSessionStateStore );
	const subscribedRunIdsBySessionRef = useRef< Map< string, string > >( new Map() );
	const ignoredRunIdsRef = useRef< Set< string > >( new Set() );
	const interruptPendingStartSessionIdsRef = useRef< Set< string > >( new Set() );

	const dispatchSession = useCallback(
		( sessionId: string, action: Action ) => {
			stateStore.dispatch( { sessionId, action } );
		},
		[ stateStore ]
	);

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

		const syncActiveRuns = async () => {
			const runIdsBefore = Object.entries( stateStore.getState() ).flatMap(
				( [ sessionId, state ] ) => ( state.runId ? [ [ sessionId, state.runId ] as const ] : [] )
			);
			let runs: ActiveAgentRun[];
			try {
				runs = await connector.getActiveAgentRuns();
			} catch {
				// A failed snapshot should not break normal live event handling.
				return;
			}
			if ( cancelled ) {
				return;
			}
			const activeRunIds = new Set( runs.map( ( run ) => run.runId ) );
			let endedRuns = false;
			// A run known before the request but missing from the snapshot ended while events were lost.
			for ( const [ sessionId, runId ] of runIdsBefore ) {
				if ( ! activeRunIds.has( runId ) && stateStore.getState()[ sessionId ]?.runId === runId ) {
					subscribedRunIdsBySessionRef.current.delete( sessionId );
					ignoredRunIdsRef.current.delete( runId );
					dispatchSession( sessionId, { type: 'run_ended' } );
					endedRuns = true;
				}
			}
			for ( const run of runs ) {
				subscribedRunIdsBySessionRef.current.set( run.sessionId, run.runId );
				dispatchSession( run.sessionId, {
					type: 'hydrate_active_run',
					runId: run.runId,
					startedAt: run.startedAt,
					interrupting: run.phase === 'interrupting',
					pendingQuestions: run.pendingQuestions,
				} );
			}
			if ( endedRuns ) {
				void queryClient.invalidateQueries( { queryKey: SESSIONS_QUERY_KEY } );
			}
		};

		void syncActiveRuns();
		const unsubscribe = connector.onConnectionRestored?.( () => void syncActiveRuns() );
		return () => {
			cancelled = true;
			unsubscribe?.();
		};
	}, [ connector, dispatchSession, queryClient, stateStore ] );

	useEffect( () => {
		const endRun = ( sessionId: string ) => {
			const hasQueuedFollowUp =
				( stateStore.getState()[ sessionId ] ?? initialState ).queuedPrompts.length > 0;
			dispatchSession( sessionId, { type: 'run_ended' } );
			subscribedRunIdsBySessionRef.current.delete( sessionId );
			// The finished run consumed AI credits; refresh the balance shown
			// in the composer and in Settings → Usage.
			void queryClient.invalidateQueries( { queryKey: ASSISTANT_QUOTA_QUERY_KEY } );
			if ( ! hasQueuedFollowUp ) {
				// Refetch to replace optimistic entries with disk-backed ones.
				// `cancelRefetch: false` so a run ending as its site is deleted
				// can't cancel the redirect route's in-flight fetch (which would
				// throw a CancelledError into the router's error boundary).
				void queryClient.invalidateQueries(
					{ queryKey: SESSIONS_QUERY_KEY },
					{ cancelRefetch: false }
				);
			}
		};

		return connector.onAgentEvent( ( payload: AgentRunEvent ) => {
			const exited =
				payload.event.type === 'run.exited' || payload.event.type === 'run.interrupted';
			if ( ignoredRunIdsRef.current.has( payload.runId ) ) {
				if ( exited ) {
					ignoredRunIdsRef.current.delete( payload.runId );
					if ( stateStore.getState()[ payload.sessionId ]?.runId === payload.runId ) {
						endRun( payload.sessionId );
					}
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
				case 'error':
					toast.error( event.message );
					return;
				case 'turn.completed':
					dispatchSession( payload.sessionId, { type: 'turn_completed' } );
					return;
				case 'run.interrupting':
					dispatchSession( payload.sessionId, { type: 'interrupt_requested' } );
					return;
				case 'run.exited':
				case 'run.interrupted': {
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
					endRun( payload.sessionId );
					return;
				}
				case 'message': {
					const inner = event.message;
					// A failed turn only surfaces through its final `agent_end` —
					// the errored assistant message usually has no text content and
					// no `error` transport event is emitted. Synthesize the
					// `studio.turn_closed` error entry for immediate in-flow
					// rendering; the CLI also writes a real one that replaces this
					// on the post-run refetch.
					const failure = getAgentEndFailure( inner );
					if ( failure ) {
						updateCache( payload.sessionId, ( entries ) => [
							...entries,
							{
								type: 'custom',
								id: shortEntryId(),
								parentId: null,
								timestamp: event.timestamp,
								customType: 'studio.turn_closed',
								data: { status: 'error', errorMessage: failure.message },
							} as SessionEntry,
						] );
						return;
					}
					// Only message-bearing pi event variants need optimistic entries.
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
					} else if ( inner.type === 'tool_execution_update' ) {
						const progress = getStudioToolProgress( inner.partialResult );
						if ( progress?.message.trim() ) {
							updateCache( payload.sessionId, ( entries ) => [
								...entries,
								{
									type: 'custom',
									id: shortEntryId(),
									parentId: null,
									timestamp: event.timestamp,
									customType: 'studio.tool_progress',
									data: { message: progress.message, toolCallId: inner.toolCallId },
								} as SessionEntry,
							] );
						}
					}
					return;
				}
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
									data: q,
								} ) as SessionEntry
						),
					] );
					dispatchSession( payload.sessionId, {
						type: 'questions_added',
						questions: event.questions,
					} );
					return;
			}
		} );
	}, [ connector, dispatchSession, queryClient, stateStore, updateCache ] );

	const startRun = useCallback(
		async ( sessionId: string, prompt: string, options: SendMessageOptions = {} ) => {
			const displayMessage = options.displayMessage ?? prompt;
			const images = options.images ?? [];
			const files = options.files ?? [];
			const visualAnnotations = options.visualAnnotations;
			// Synchronous, so a second send in the same tick queues behind this one.
			dispatchSession( sessionId, { type: 'send_pending', startedAt: Date.now() } );
			await queryClient.cancelQueries( { queryKey: [ ...SESSIONS_QUERY_KEY, sessionId ] } );

			const optimisticEntry: SessionEntry = {
				type: 'custom',
				id: shortEntryId(),
				parentId: null,
				timestamp: nowIso(),
				customType: 'studio.user_prompt',
				data: {
					text: displayMessage,
					source: 'prompt',
					attachments: buildChatAttachmentSummaries( images, files ),
					visualAnnotations,
				},
			} as SessionEntry;
			updateCache( sessionId, ( entries ) => [ ...entries, optimisticEntry ] );

			try {
				const { runId: newRunId } = await connector.continueSession( sessionId, prompt, {
					displayMessage,
					images,
					files,
					visualAnnotations,
				} );
				if ( interruptPendingStartSessionIdsRef.current.has( sessionId ) ) {
					interruptPendingStartSessionIdsRef.current.delete( sessionId );
					ignoredRunIdsRef.current.add( newRunId );
					dispatchSession( sessionId, {
						type: 'hydrate_active_run',
						runId: newRunId,
						startedAt: Date.now(),
						interrupting: true,
					} );
					void connector
						.interruptAgentRun( newRunId )
						.catch( ( error ) => toast.error( String( error ) ) );
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
				interruptPendingStartSessionIdsRef.current.delete( sessionId );
				dispatchSession( sessionId, { type: 'run_ended' } );
				toast.error( err instanceof Error ? err.message : String( err ) );
				throw err;
			}
		},
		[ connector, dispatchSession, queryClient, updateCache ]
	);

	const interrupt = useCallback(
		async ( sessionId: string ) => {
			const state = stateStore.getState()[ sessionId ] ?? initialState;
			if ( state.phase === 'idle' ) {
				return;
			}
			if ( state.isInterrupting ) {
				if ( state.runId ) {
					await connector.interruptAgentRun( state.runId );
				}
				return;
			}
			// A run blocked on `ask_user` is killed mid-call, so settle the call
			// first. Without a result the model treats the question UI as broken
			// and falls back to prose for the rest of the session.
			if ( state.runId && state.pendingQuestions.length > 0 ) {
				const answers = { ...state.pendingAnswers };
				for ( const pending of state.pendingQuestions ) {
					if ( typeof answers[ pending.question ] !== 'string' ) {
						answers[ pending.question ] = STOPPED_WITHOUT_ANSWER;
					}
				}
				await connector.answerAgentQuestion( state.runId, answers );
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
			dispatchSession( sessionId, { type: 'interrupt_requested' } );
			if ( interruptedRunId ) {
				await connector.interruptAgentRun( interruptedRunId );
			}
		},
		[ connector, dispatchSession, stateStore, updateCache ]
	);

	// The transcript reads the highlight straight off the cached entry, so a pick
	// and its retraction both have to land there as well as in the reducer.
	const setCachedSelectedLabel = useCallback(
		( sessionId: string, question: string, answer: string | undefined ) => {
			updateCache( sessionId, ( entries ) => {
				let targetIndex = -1;
				for ( let index = entries.length - 1; index >= 0; index -= 1 ) {
					const entry = entries[ index ];
					if ( entry.type !== 'custom' || entry.customType !== 'studio.agent_question' ) {
						continue;
					}
					const data = ( entry as StudioCustomEntry< 'studio.agent_question' > ).data;
					if ( data?.question === question ) {
						targetIndex = index;
						break;
					}
				}
				if ( targetIndex === -1 ) {
					return entries;
				}
				return entries.map( ( entry, index ) => {
					if ( index !== targetIndex ) {
						return entry;
					}
					const questionEntry = entry as StudioCustomEntry< 'studio.agent_question' >;
					return {
						...questionEntry,
						data: {
							...questionEntry.data,
							selectedLabel: answer,
						},
					} as SessionEntry;
				} );
			} );
		},
		[ updateCache ]
	);

	// Arming a free-form reply retracts the pick it replaces, so the batch stays
	// open until the typed answer lands.
	const clearQuestionAnswer = useCallback(
		( sessionId: string, question: string ) => {
			setCachedSelectedLabel( sessionId, question, undefined );
			dispatchSession( sessionId, { type: 'question_answer_cleared', question } );
		},
		[ dispatchSession, setCachedSelectedLabel ]
	);

	const answerQuestion = useCallback(
		( sessionId: string, question: string, answer: string ) => {
			const state = stateStore.getState()[ sessionId ] ?? initialState;
			if ( ! state.runId ) {
				return;
			}
			// Only a real selection lights up an option. A typed reply renders as a
			// message instead, so recording it here would show it twice.
			const isListedOption = state.pendingQuestions
				.find( ( pending ) => pending.question === question )
				?.options.some( ( option ) => option.label === answer );
			if ( isListedOption ) {
				setCachedSelectedLabel( sessionId, question, answer );
			}
			const nextAnswers = { ...state.pendingAnswers, [ question ]: answer };
			const complete = state.pendingQuestions.every(
				( q ) => typeof nextAnswers[ q.question ] === 'string'
			);
			if ( complete ) {
				dispatchSession( sessionId, { type: 'batch_dispatched' } );
				const runId = state.runId;
				void connector.answerAgentQuestion( runId, nextAnswers ).catch( ( error ) => {
					if ( stateStore.getState()[ sessionId ]?.runId !== runId ) {
						return;
					}
					dispatchSession( sessionId, {
						type: 'questions_added',
						questions: state.pendingQuestions,
					} );
					toast.error( error instanceof Error ? error.message : String( error ) );
				} );
			} else {
				dispatchSession( sessionId, { type: 'question_answered', question, answer } );
			}
		},
		[ connector, dispatchSession, setCachedSelectedLabel, stateStore ]
	);

	const value = useMemo< AgentRunStore >(
		() => ( {
			stateStore,
			dispatchSession,
			startRun,
			interrupt,
			answerQuestion,
			clearQuestionAnswer,
		} ),
		[ answerQuestion, clearQuestionAnswer, dispatchSession, interrupt, startRun, stateStore ]
	);

	return (
		<AgentRunContext.Provider value={ value }>
			<QueueDispatchers />
			{ children }
		</AgentRunContext.Provider>
	);
}

// One dispatcher per session with queued prompts, so a queue keeps draining
// after its chat is closed.
function QueueDispatchers() {
	const store = useAgentRunStore();
	const ids = useSyncExternalStore( store.stateStore.subscribe, () =>
		Object.entries( store.stateStore.getState() )
			.filter( ( [ , state ] ) => state.queuedPrompts.length > 0 )
			.map( ( [ sessionId ] ) => sessionId )
			.join( ' ' )
	);
	return ids
		? ids
				.split( ' ' )
				.map( ( sessionId ) => <QueueDispatcher key={ sessionId } sessionId={ sessionId } /> )
		: null;
}

function QueueDispatcher( { sessionId }: { sessionId: string } ) {
	const { stateStore, dispatchSession, startRun } = useAgentRunStore();
	const state = useSyncExternalStore(
		stateStore.subscribe,
		() => stateStore.getState()[ sessionId ] ?? initialState
	);
	const { data: session } = useSession( sessionId );
	const { data: aiSettings, isPending: isAiSettingsPending } = useAiSettings();
	const isOutOfCredits = useIsOutOfAiCredits();
	// Holding rather than clearing: a balance spent mid-run leaves the queued
	// prompt visible and it dispatches on its own once a top-up refreshes the
	// quota, instead of being silently dropped or sent to a certain rejection.
	const held =
		! session ||
		isAiSettingsPending ||
		( isOutOfCredits && getEffectiveSessionProvider( session.entries, aiSettings ) === 'wpcom' );
	const next = state.phase === 'idle' && ! held ? state.queuedPrompts[ 0 ] : undefined;

	useEffect( () => {
		const live = stateStore.getState()[ sessionId ];
		if ( ! next || live?.phase !== 'idle' || live.queuedPrompts[ 0 ] !== next ) {
			return;
		}
		dispatchSession( sessionId, { type: 'queue_shift' } );
		const { id: _id, prompt, ...options } = next;
		// On failure, drop the whole queue so a broken backend doesn't cascade errors.
		startRun( sessionId, prompt, options ).catch( () =>
			dispatchSession( sessionId, { type: 'queue_clear' } )
		);
	}, [ dispatchSession, next, sessionId, startRun, stateStore ] );

	return null;
}

function useAgentRunStore(): AgentRunStore {
	const store = useContext( AgentRunContext );
	if ( ! store ) {
		throw new Error( 'Agent run hooks must be used within AgentRunProvider' );
	}
	return store;
}

export function useAgentRun( sessionId: string | undefined ): LiveAgentEvents {
	const {
		stateStore,
		dispatchSession,
		startRun,
		interrupt: interruptRun,
		answerQuestion: answerRunQuestion,
		clearQuestionAnswer: clearRunQuestionAnswer,
	} = useAgentRunStore();
	// Per-session slices keep their identity while other sessions update, so
	// this only re-renders when this session's state actually changes.
	const state = useSyncExternalStore( stateStore.subscribe, () =>
		sessionId ? stateStore.getState()[ sessionId ] ?? initialState : initialState
	);
	const { phase, startedAt, isInterrupting, pendingQuestions, pendingAnswers, queuedPrompts } =
		state;

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
						visualAnnotations: options.visualAnnotations,
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

	const clearQuestionAnswer = useCallback(
		( question: string ) => {
			if ( ! sessionId ) {
				return;
			}
			clearRunQuestionAnswer( sessionId, question );
		},
		[ clearRunQuestionAnswer, sessionId ]
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
		pendingQuestions,
		pendingAnswers,
		queuedPrompts,
		sendMessage,
		interrupt,
		answerQuestion,
		clearQuestionAnswer,
		removeQueuedPrompt,
	};
}

function hasUnansweredQuestion( state: State ): boolean {
	return state.pendingQuestions.some(
		( pendingQuestion ) => typeof state.pendingAnswers[ pendingQuestion.question ] !== 'string'
	);
}

/** Sessions waiting on the user's answer to a question. */
export function useSessionsNeedingInput(): string[] {
	const store = useAgentRunStore();
	// Joined so the snapshot compares by value; a fresh array would re-render forever.
	const ids = useSyncExternalStore( store.stateStore.subscribe, () =>
		Object.entries( store.stateStore.getState() )
			.filter( ( [ , state ] ) => hasUnansweredQuestion( state ) )
			.map( ( [ sessionId ] ) => sessionId )
			.join( ' ' )
	);
	return useMemo( () => ( ids ? ids.split( ' ' ) : [] ), [ ids ] );
}

/**
 * Aggregate read-only activity for a site row. Pending questions outrank
 * active work because they need the user's attention; otherwise any
 * starting/running session makes the site read as working.
 */
export function useSiteAgentActivity( sessionIds: string[] ): SiteAgentActivity {
	const store = useAgentRunStore();
	return useSyncExternalStore( store.stateStore.subscribe, () => {
		let hasWorkingSession = false;
		for ( const sessionId of sessionIds ) {
			const state = store.stateStore.getState()[ sessionId ];
			if ( ! state ) {
				continue;
			}
			if ( hasUnansweredQuestion( state ) ) {
				return 'pending-question';
			}
			if ( state.phase === 'starting' || state.phase === 'running' ) {
				hasWorkingSession = true;
			}
		}
		return hasWorkingSession ? 'working' : 'idle';
	} );
}
