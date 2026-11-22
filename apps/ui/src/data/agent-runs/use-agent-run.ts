import { useCallback, useMemo, useSyncExternalStore } from 'react';
import { useAgentRunStore } from './context';
import {
	hasUnansweredQuestion,
	initialAgentRunState,
	type PendingQuestion,
	type QueuedPrompt,
	type SendMessageOptions,
} from './store';

export type { QueuedPrompt } from './store';

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

type SiteAgentActivity = 'idle' | 'working' | 'pending-question';

function newId(): string {
	return `${ Date.now().toString( 36 ) }-${ Math.random().toString( 36 ).slice( 2, 10 ) }`;
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
		sessionId ? stateStore.getState()[ sessionId ] ?? initialAgentRunState : initialAgentRunState
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

/** Sessions waiting on the user's answer to a question. */
export function useSessionsNeedingInput(): string[] {
	const { stateStore } = useAgentRunStore();
	// Joined so the snapshot compares by value; a fresh array would re-render forever.
	const ids = useSyncExternalStore( stateStore.subscribe, () =>
		Object.entries( stateStore.getState() )
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
	const { stateStore } = useAgentRunStore();
	return useSyncExternalStore( stateStore.subscribe, () => {
		let hasWorkingSession = false;
		for ( const sessionId of sessionIds ) {
			const state = stateStore.getState()[ sessionId ];
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

/** Whether any of the sessions is running or has prompts queued, so it can't be archived yet. */
export function useSessionsBusy( sessionIds: string[] ): boolean {
	const { stateStore } = useAgentRunStore();
	return useSyncExternalStore( stateStore.subscribe, () =>
		sessionIds.some( ( sessionId ) => {
			const state = stateStore.getState()[ sessionId ];
			return !! state && ( state.phase !== 'idle' || state.queuedPrompts.length > 0 );
		} )
	);
}
