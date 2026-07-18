import { buildChatAttachmentSummaries } from '@studio/common/ai/chat-attachments';
import { useQueryClient } from '@tanstack/react-query';
import { __ } from '@wordpress/i18n';
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
import { useConnector } from '@/data/core';
import { SESSIONS_QUERY_KEY } from '@/data/queries/use-sessions';
import type {
	AgentEvent,
	AgentRunEvent,
	LoadedAiSession,
	PermissionDecision,
	PermissionRequestData,
	SessionEntry,
	StudioChatFileAttachment,
	StudioChatImage,
	StudioCustomEntry,
} from '@/data/core';

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

export interface ActiveToolState {
	name: string;
	input: Record< string, unknown >;
	startedAt: number;
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
	activeTool: ActiveToolState | null;
	error: string | null;
	pendingQuestions: PendingQuestion[];
	// Gated tool calls awaiting the user's decision, in arrival order. Each
	// blocks the agent turn until answered.
	pendingPermissions: PermissionRequestData[];
	// Decisions already sent this session, keyed by request id, so the card
	// stays resolved while the disk-backed entry catches up.
	answeredPermissions: Record< string, PermissionDecision >;
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
	answerPermission: ( requestId: string, decision: PermissionDecision ) => void;
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
	activeTool: ActiveToolState | null;
	error: string | null;
	isInterrupting: boolean;
	pendingQuestions: PendingQuestion[];
	pendingPermissions: PermissionRequestData[];
	answeredPermissions: Record< string, PermissionDecision >;
	pendingAnswers: Record< string, string >;
	queuedPrompts: QueuedPrompt[];
}

// Read-only view of a session's live-run slice for non-rendering observers
// (e.g. the chat-notifications watcher).
export type AgentRunSessionState = Readonly< State >;

const initialState: State = {
	phase: 'idle',
	runId: null,
	startedAt: null,
	activeTool: null,
	error: null,
	isInterrupting: false,
	pendingQuestions: [],
	pendingPermissions: [],
	answeredPermissions: {},
	pendingAnswers: {},
	queuedPrompts: [],
};

type Action =
	| { type: 'hydrate_active_run'; runId: string; startedAt: number; interrupting: boolean }
	| { type: 'send_pending'; startedAt: number }
	| { type: 'send_start'; runId: string; startedAt: number }
	| { type: 'error_set'; message: string | null }
	| { type: 'turn_completed' }
	| { type: 'run_ended' }
	| { type: 'interrupt_requested' }
	| { type: 'questions_added'; questions: PendingQuestion[] }
	| { type: 'question_answered'; question: string; answer: string }
	| { type: 'batch_dispatched' }
	| { type: 'permission_requested'; request: PermissionRequestData }
	| { type: 'permission_answered'; requestId: string; decision: PermissionDecision }
	| { type: 'queue_append'; prompt: QueuedPrompt }
	| { type: 'queue_remove'; id: string }
	| { type: 'queue_shift' }
	| { type: 'queue_clear' }
	| {
			type: 'tool_execution_started';
			name: string;
			input: Record< string, unknown >;
			startedAt: number;
	  }
	| { type: 'tool_execution_ended' };

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
				activeTool: null,
				error: null,
				isInterrupting: false,
			};
		case 'send_start':
			return {
				...state,
				phase: 'running',
				runId: action.runId,
				startedAt: action.startedAt,
				activeTool: null,
				error: null,
				isInterrupting: false,
			};
		case 'error_set':
			return { ...state, error: action.message };
		case 'turn_completed':
			return {
				...state,
				phase: state.phase === 'idle' ? 'idle' : 'winding_down',
				activeTool: null,
				pendingQuestions: [],
				pendingPermissions: [],
				pendingAnswers: {},
			};
		case 'run_ended':
			// Preserve the queue across run boundaries so staged follow-ups
			// survive the transition, and the answered-permissions map so
			// resolved cards stay labeled. Everything else resets.
			return {
				...initialState,
				queuedPrompts: state.queuedPrompts,
				answeredPermissions: state.answeredPermissions,
			};
		case 'interrupt_requested':
			return {
				...state,
				phase: 'idle',
				runId: null,
				startedAt: null,
				activeTool: null,
				isInterrupting: false,
				pendingQuestions: [],
				pendingPermissions: [],
				pendingAnswers: {},
			};
		case 'questions_added': {
			// Both the live event and active-run hydration can deliver the same
			// questions (e.g. right after a renderer reload) — keep one of each.
			const fresh = action.questions.filter(
				( question ) =>
					! state.pendingQuestions.some( ( pending ) => pending.question === question.question )
			);
			if ( fresh.length === 0 ) {
				return state;
			}
			return {
				...state,
				pendingQuestions: [ ...state.pendingQuestions, ...fresh ],
			};
		}
		case 'question_answered':
			return {
				...state,
				pendingAnswers: { ...state.pendingAnswers, [ action.question ]: action.answer },
			};
		case 'batch_dispatched':
			return { ...state, pendingQuestions: [], pendingAnswers: {} };
		case 'permission_requested':
			// Both the live event and active-run hydration can deliver the same
			// request (e.g. right after a renderer reload) — keep one.
			if ( state.pendingPermissions.some( ( request ) => request.id === action.request.id ) ) {
				return state;
			}
			return {
				...state,
				pendingPermissions: [ ...state.pendingPermissions, action.request ],
			};
		case 'permission_answered':
			return {
				...state,
				pendingPermissions: state.pendingPermissions.filter(
					( request ) => request.id !== action.requestId
				),
				answeredPermissions: {
					...state.answeredPermissions,
					[ action.requestId ]: action.decision,
				},
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
		case 'tool_execution_started':
			return {
				...state,
				activeTool: {
					name: action.name,
					input: action.input,
					startedAt: action.startedAt,
				},
			};
		case 'tool_execution_ended':
			return { ...state, activeTool: null };
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
export interface SessionStateStore {
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

export interface AgentRunStore {
	stateStore: SessionStateStore;
	dispatchSession: ( sessionId: string, action: Action ) => void;
	startRun: ( sessionId: string, prompt: string, options?: SendMessageOptions ) => Promise< void >;
	interrupt: ( sessionId: string ) => Promise< void >;
	answerQuestion: ( sessionId: string, question: string, answer: string ) => void;
	answerPermission: ( sessionId: string, requestId: string, decision: PermissionDecision ) => void;
}

const AgentRunContext = createContext< AgentRunStore | null >( null );

export function AgentRunProvider( { children }: PropsWithChildren ) {
	const connector = useConnector();
	const queryClient = useQueryClient();
	const [ stateStore ] = useState( createSessionStateStore );
	const subscribedRunIdsBySessionRef = useRef< Map< string, string > >( new Map() );
	const ignoredRunIdsRef = useRef< Set< string > >( new Set() );
	const interruptRequestsBySessionRef = useRef< Map< string, Promise< void > > >( new Map() );
	const interruptPendingStartSessionIdsRef = useRef< Set< string > >( new Set() );
	// Sessions whose transcript cache may have missed a live event: the event
	// landed while the transcript had no data yet (fresh renderer, its initial
	// load still in flight) or while a refetch was in flight (whose snapshot was
	// read from disk before the event and will overwrite the appended entry when
	// it resolves). The CLI persists every entry to the JSONL *before* emitting
	// its event, so disk is always at least as new as any event — flagged
	// sessions just need one more refetch after the in-flight one settles.
	const reconcileSessionIdsRef = useRef< Set< string > >( new Set() );

	const dispatchSession = useCallback(
		( sessionId: string, action: Action ) => {
			stateStore.dispatch( { sessionId, action } );
		},
		[ stateStore ]
	);

	const updateCache = useCallback(
		( sessionId: string, updater: ( entries: SessionEntry[] ) => SessionEntry[] ) => {
			const queryKey = [ ...SESSIONS_QUERY_KEY, sessionId ];
			const queryState = queryClient.getQueryState< LoadedAiSession >( queryKey );
			if ( ! queryState?.data || queryState.fetchStatus === 'fetching' ) {
				reconcileSessionIdsRef.current.add( sessionId );
			}
			queryClient.setQueryData< LoadedAiSession >( queryKey, ( prev ) => {
				if ( ! prev ) {
					return prev;
				}
				const current = prev.entries ?? [];
				const entries = updater( current );
				return entries === current ? prev : { ...prev, entries };
			} );
		},
		[ queryClient ]
	);

	// Second half of the reconcile contract: once a flagged session's transcript
	// fetch settles, refetch it. That fetch started after the flagged event, so
	// its disk snapshot is guaranteed to contain the event's entry. If more
	// events land during the reconciling fetch they re-flag the session, and the
	// loop converges as soon as a fetch window passes without one.
	useEffect( () => {
		return queryClient.getQueryCache().subscribe( ( event ) => {
			if ( event.type !== 'updated' ) {
				return;
			}
			if ( event.action.type !== 'success' && event.action.type !== 'error' ) {
				return;
			}
			const queryKey = event.query.queryKey;
			if (
				! Array.isArray( queryKey ) ||
				queryKey.length !== SESSIONS_QUERY_KEY.length + 1 ||
				queryKey[ 0 ] !== SESSIONS_QUERY_KEY[ 0 ]
			) {
				return;
			}
			const sessionId = queryKey[ SESSIONS_QUERY_KEY.length ];
			if ( typeof sessionId !== 'string' || ! reconcileSessionIdsRef.current.delete( sessionId ) ) {
				return;
			}
			// Deferred so the refetch isn't started from inside the query cache's
			// own notification cycle.
			queueMicrotask( () => {
				void queryClient.invalidateQueries( {
					queryKey: [ ...SESSIONS_QUERY_KEY, sessionId ],
					exact: true,
				} );
			} );
		} );
	}, [ queryClient ] );

	useEffect( () => {
		let cancelled = false;

		// Reconcile persisted transcripts with disk once per renderer boot.
		// Session queries never refetch on their own (staleTime: Infinity —
		// live events own the cache during a run), so anything that happened
		// while this renderer wasn't alive (a question asked mid-restart, a
		// run that finished with the app closed) would otherwise never appear.
		// Invalidation refetches the open transcript now and marks the rest
		// stale so they refetch on mount.
		void queryClient.invalidateQueries( { queryKey: SESSIONS_QUERY_KEY } );

		void connector
			.getActiveAgentRuns()
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
					// Restore what the run is still blocked on — the live events
					// predate this renderer, but the agent process is waiting on the
					// answers. The transcript entries come from disk; this makes the
					// question and permission cards interactive again.
					if ( ( run.pendingQuestions ?? [] ).length > 0 ) {
						dispatchSession( run.sessionId, {
							type: 'questions_added',
							questions: run.pendingQuestions ?? [],
						} );
					}
					for ( const request of run.pendingPermissions ?? [] ) {
						dispatchSession( run.sessionId, { type: 'permission_requested', request } );
					}
				}
			} )
			.catch( () => {
				// A failed snapshot should not break normal live event handling.
			} );

		return () => {
			cancelled = true;
		};
	}, [ connector, dispatchSession, queryClient ] );

	useEffect( () => {
		return connector.onAgentEvent( ( payload: AgentRunEvent ) => {
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
				case 'error':
					dispatchSession( payload.sessionId, { type: 'error_set', message: event.message } );
					return;
				case 'turn.completed':
					// A turn can "complete" by dying (e.g. the model API
					// rejecting the request). Without surfacing the status the
					// failure is indistinguishable from a hang.
					if ( event.status === 'error' ) {
						dispatchSession( payload.sessionId, {
							type: 'error_set',
							message: __(
								'The agent stopped with an error. Try again — if it keeps failing, the last message (or an attachment) may be the cause; start a new chat without it.'
							),
						} );
					}
					dispatchSession( payload.sessionId, { type: 'turn_completed' } );
					return;
				case 'run.interrupting':
					dispatchSession( payload.sessionId, { type: 'interrupt_requested' } );
					return;
				case 'run.exited':
				case 'run.interrupted': {
					const hasQueuedFollowUp =
						( stateStore.getState()[ payload.sessionId ] ?? initialState ).queuedPrompts.length > 0;
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
					if ( ! hasQueuedFollowUp ) {
						// Refetch to replace optimistic entries with disk-backed ones.
						// Scoped to this session (plus the summaries list) — a broad
						// invalidate would force-refetch every mounted transcript, and
						// a refetch racing another session's live run can clobber its
						// just-appended entries (e.g. a pending agent question).
						void queryClient.invalidateQueries( {
							queryKey: SESSIONS_QUERY_KEY,
							exact: true,
						} );
						void queryClient.invalidateQueries( {
							queryKey: [ ...SESSIONS_QUERY_KEY, payload.sessionId ],
							exact: true,
						} );
					}
					return;
				}
				case 'message': {
					// Only message-bearing pi event variants need optimistic entries.
					const inner = event.message;
					if ( inner.type === 'tool_execution_start' ) {
						const name = typeof inner.toolName === 'string' ? inner.toolName : 'tool';
						const input =
							inner.args && typeof inner.args === 'object' && ! Array.isArray( inner.args )
								? ( inner.args as Record< string, unknown > )
								: {};
						dispatchSession( payload.sessionId, {
							type: 'tool_execution_started',
							name,
							input,
							startedAt: getTimestampMs( event.timestamp ),
						} );
						return;
					}
					if ( inner.type === 'tool_execution_end' ) {
						dispatchSession( payload.sessionId, { type: 'tool_execution_ended' } );
						return;
					}
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
				case 'permission.requested':
					updateCache( payload.sessionId, ( entries ) => [
						...entries,
						{
							type: 'custom',
							id: shortEntryId(),
							parentId: null,
							timestamp: event.timestamp,
							customType: 'studio.permission_request',
							data: event.request,
						} as SessionEntry,
					] );
					dispatchSession( payload.sessionId, {
						type: 'permission_requested',
						request: event.request,
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
			dispatchSession( sessionId, { type: 'error_set', message: null } );
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
				},
			} as SessionEntry;
			updateCache( sessionId, ( entries ) => [ ...entries, optimisticEntry ] );
			dispatchSession( sessionId, { type: 'send_pending', startedAt: Date.now() } );

			try {
				await interruptRequestsBySessionRef.current.get( sessionId );
				const { runId: newRunId } = await connector.continueSession( sessionId, prompt, {
					displayMessage,
					images,
					files,
				} );
				if ( interruptPendingStartSessionIdsRef.current.has( sessionId ) ) {
					interruptPendingStartSessionIdsRef.current.delete( sessionId );
					ignoredRunIdsRef.current.add( newRunId );
					const interruptRequest = connector.interruptAgentRun( newRunId ).finally( () => {
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
				const message = err instanceof Error ? err.message : String( err );
				dispatchSession( sessionId, { type: 'error_set', message } );
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
			const interruptRequest = connector.interruptAgentRun( interruptedRunId ).finally( () => {
				if ( interruptRequestsBySessionRef.current.get( sessionId ) === interruptRequest ) {
					interruptRequestsBySessionRef.current.delete( sessionId );
				}
			} );
			interruptRequestsBySessionRef.current.set( sessionId, interruptRequest );
			await interruptRequest;
		},
		[ connector, dispatchSession, stateStore, updateCache ]
	);

	const answerQuestion = useCallback(
		( sessionId: string, question: string, answer: string ) => {
			const state = stateStore.getState()[ sessionId ] ?? initialState;
			if ( ! state.runId ) {
				return;
			}
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
			const nextAnswers = { ...state.pendingAnswers, [ question ]: answer };
			const complete = state.pendingQuestions.every(
				( q ) => typeof nextAnswers[ q.question ] === 'string'
			);
			if ( complete ) {
				dispatchSession( sessionId, { type: 'batch_dispatched' } );
				void connector.answerAgentQuestion( state.runId, nextAnswers );
			} else {
				dispatchSession( sessionId, { type: 'question_answered', question, answer } );
			}
		},
		[ connector, dispatchSession, stateStore, updateCache ]
	);

	const answerPermission = useCallback(
		( sessionId: string, requestId: string, decision: PermissionDecision ) => {
			const state = stateStore.getState()[ sessionId ] ?? initialState;
			if ( ! state.runId ) {
				return;
			}
			dispatchSession( sessionId, { type: 'permission_answered', requestId, decision } );
			// Optimistic response entry so the transcript pairs the request with
			// its outcome before the disk refetch lands.
			updateCache( sessionId, ( entries ) => [
				...entries,
				{
					type: 'custom',
					id: shortEntryId(),
					parentId: null,
					timestamp: nowIso(),
					customType: 'studio.permission_response',
					data: { id: requestId, decision },
				} as SessionEntry,
			] );
			void connector.answerAgentPermission( state.runId, requestId, decision );
		},
		[ connector, dispatchSession, stateStore, updateCache ]
	);

	const value = useMemo< AgentRunStore >(
		() => ( {
			stateStore,
			dispatchSession,
			startRun,
			interrupt,
			answerQuestion,
			answerPermission,
		} ),
		[ answerPermission, answerQuestion, dispatchSession, interrupt, startRun, stateStore ]
	);

	return <AgentRunContext.Provider value={ value }>{ children }</AgentRunContext.Provider>;
}

// Direct access to the per-session state store for imperative observers that
// must not re-render on every dispatch (e.g. the chat-notifications watcher).
export function useAgentRunStore(): AgentRunStore {
	const store = useContext( AgentRunContext );
	if ( ! store ) {
		throw new Error( 'useAgentRunStore must be used within AgentRunProvider' );
	}
	return store;
}

export function useAgentRun( sessionId: string | undefined ): LiveAgentEvents {
	const store = useContext( AgentRunContext );
	if ( ! store ) {
		throw new Error( 'useAgentRun must be used within AgentRunProvider' );
	}

	const {
		stateStore,
		dispatchSession,
		startRun,
		interrupt: interruptRun,
		answerQuestion: answerRunQuestion,
		answerPermission: answerRunPermission,
	} = store;
	// Per-session slices keep their identity while other sessions update, so
	// this only re-renders when this session's state actually changes.
	const state = useSyncExternalStore( stateStore.subscribe, () =>
		sessionId ? stateStore.getState()[ sessionId ] ?? initialState : initialState
	);
	const {
		phase,
		startedAt,
		activeTool,
		error,
		isInterrupting,
		pendingQuestions,
		pendingPermissions,
		answeredPermissions,
		pendingAnswers,
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
		dispatchSession( sessionId, { type: 'queue_shift' } );
		void ( async () => {
			try {
				await startRun( sessionId, next.prompt, {
					displayMessage: next.displayMessage,
					images: next.images,
					files: next.files,
				} );
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
			// answers or a permission decision, or if earlier queued prompts
			// haven't been dispatched yet (preserves FIFO order).
			if (
				phase !== 'idle' ||
				pendingQuestions.length > 0 ||
				pendingPermissions.length > 0 ||
				queuedPrompts.length > 0
			) {
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
		[
			dispatchSession,
			phase,
			pendingQuestions.length,
			pendingPermissions.length,
			queuedPrompts.length,
			sessionId,
			startRun,
		]
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

	const answerPermission = useCallback(
		( requestId: string, decision: PermissionDecision ) => {
			if ( ! sessionId ) {
				return;
			}
			answerRunPermission( sessionId, requestId, decision );
		},
		[ answerRunPermission, sessionId ]
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
		activeTool,
		error,
		pendingQuestions,
		pendingPermissions,
		answeredPermissions,
		pendingAnswers,
		queuedPrompts,
		sendMessage,
		interrupt,
		answerQuestion,
		answerPermission,
		removeQueuedPrompt,
	};
}

/**
 * Aggregate read-only activity for a site row. Pending questions outrank
 * active work because they need the user's attention; otherwise any
 * starting/running session makes the site read as working.
 */
export function useSiteAgentActivity( sessionIds: string[] ): SiteAgentActivity {
	const store = useContext( AgentRunContext );
	if ( ! store ) {
		throw new Error( 'useSiteAgentActivity must be used within AgentRunProvider' );
	}
	return useSyncExternalStore( store.stateStore.subscribe, () => {
		let hasWorkingSession = false;
		for ( const sessionId of sessionIds ) {
			const state = store.stateStore.getState()[ sessionId ];
			if ( ! state ) {
				continue;
			}
			const hasPendingQuestion = state.pendingQuestions.some(
				( pendingQuestion ) => typeof state.pendingAnswers[ pendingQuestion.question ] !== 'string'
			);
			// A pending permission needs the user's attention just like a question.
			if ( hasPendingQuestion || state.pendingPermissions.length > 0 ) {
				return 'pending-question';
			}
			if ( state.phase === 'starting' || state.phase === 'running' ) {
				hasWorkingSession = true;
			}
		}
		return hasWorkingSession ? 'working' : 'idle';
	} );
}
