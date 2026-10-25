import { buildChatAttachmentSummaries } from '@studio/common/ai/chat-attachments';
import { getAgentEndFailure } from '@studio/common/ai/json-events';
import { getStudioToolProgress } from '@studio/common/ai/tool-progress';
import { STOPPED_WITHOUT_ANSWER } from '@studio/common/ai/tools';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState, type PropsWithChildren } from 'react';
import { toast } from '@/data/app-messages';
import { useConnector } from '@/data/core';
import { ASSISTANT_QUOTA_QUERY_KEY } from '@/data/queries/use-assistant-quota';
import { SESSIONS_QUERY_KEY } from '@/data/queries/use-sessions';
import { AgentRunContext, type AgentRunStore } from './context';
import { QueueDispatchers } from './queue-dispatchers';
import {
	createSessionStateStore,
	initialAgentRunState,
	type AgentRunAction,
	type SendMessageOptions,
} from './store';
import type {
	AgentEvent,
	AgentRunEvent,
	LoadedAiSession,
	SessionEntry,
	StudioCustomEntry,
} from '@/data/core';
import type { ActiveAgentRun } from '@studio/common/ai/agent-events';

function nowIso(): string {
	return new Date().toISOString();
}

// Optimistic entry id; the next refetch replaces it with the disk-backed one.
function shortEntryId(): string {
	return Math.random().toString( 36 ).slice( 2, 10 );
}

function getTimestampMs( timestamp: string ): number {
	const parsed = Date.parse( timestamp );
	return Number.isNaN( parsed ) ? Date.now() : parsed;
}

export function AgentRunProvider( { children }: PropsWithChildren ) {
	const connector = useConnector();
	const queryClient = useQueryClient();
	const [ stateStore ] = useState( createSessionStateStore );
	const subscribedRunIdsBySessionRef = useRef< Map< string, string > >( new Map() );
	const ignoredRunIdsRef = useRef< Set< string > >( new Set() );
	const interruptPendingStartSessionIdsRef = useRef< Set< string > >( new Set() );
	// Bumped by every change to a session's run, so a snapshot of active runs
	// requested before the change doesn't overwrite it when it lands.
	const sessionRevisionsRef = useRef< Map< string, number > >( new Map() );

	const dispatchSession = useCallback(
		( sessionId: string, action: AgentRunAction ) => {
			if ( ! action.type.startsWith( 'queue_' ) ) {
				sessionRevisionsRef.current.set(
					sessionId,
					( sessionRevisionsRef.current.get( sessionId ) ?? 0 ) + 1
				);
			}
			stateStore.dispatch( sessionId, action );
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
		let snapshotVersion = 0;

		// Applies the snapshot only to sessions no live event changed while it
		// was in flight, and only if no newer snapshot was requested since.
		const syncActiveRuns = async () => {
			const version = ++snapshotVersion;
			const revisions = new Map( sessionRevisionsRef.current );
			const unchanged = ( sessionId: string ) =>
				( revisions.get( sessionId ) ?? 0 ) ===
				( sessionRevisionsRef.current.get( sessionId ) ?? 0 );
			let runs: ActiveAgentRun[];
			try {
				runs = await connector.getActiveAgentRuns();
			} catch {
				// A failed snapshot should not break normal live event handling.
				return;
			}
			if ( cancelled || version !== snapshotVersion ) {
				return;
			}
			const activeSessionIds = new Set( runs.map( ( run ) => run.sessionId ) );
			// A known run missing from the snapshot ended while events were lost.
			for ( const [ sessionId, state ] of Object.entries( stateStore.getState() ) ) {
				if ( ! state.runId || activeSessionIds.has( sessionId ) || ! unchanged( sessionId ) ) {
					continue;
				}
				subscribedRunIdsBySessionRef.current.delete( sessionId );
				ignoredRunIdsRef.current.delete( state.runId );
				dispatchSession( sessionId, { type: 'run_ended' } );
			}
			for ( const run of runs ) {
				if ( ! unchanged( run.sessionId ) ) {
					continue;
				}
				subscribedRunIdsBySessionRef.current.set( run.sessionId, run.runId );
				dispatchSession( run.sessionId, {
					type: 'hydrate_active_run',
					runId: run.runId,
					startedAt: run.startedAt,
					interrupting: run.phase === 'interrupting',
					pendingQuestions: run.pendingQuestions,
				} );
			}
		};

		void syncActiveRuns();
		const unsubscribe = connector.onConnectionRestored?.( () => {
			void syncActiveRuns();
			// Chats and the credit balance may have moved on while disconnected.
			void queryClient.invalidateQueries(
				{ queryKey: SESSIONS_QUERY_KEY },
				{ cancelRefetch: false }
			);
			void queryClient.invalidateQueries( { queryKey: ASSISTANT_QUOTA_QUERY_KEY } );
		} );
		return () => {
			cancelled = true;
			unsubscribe?.();
		};
	}, [ connector, dispatchSession, queryClient, stateStore ] );

	useEffect( () => {
		const endRun = ( sessionId: string ) => {
			const hasQueuedFollowUp =
				( stateStore.getState()[ sessionId ] ?? initialAgentRunState ).queuedPrompts.length > 0;
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
			const state = stateStore.getState()[ sessionId ] ?? initialAgentRunState;
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
			const state = stateStore.getState()[ sessionId ] ?? initialAgentRunState;
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
