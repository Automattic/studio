import type {
	StudioChatFileAttachment,
	StudioChatImage,
	StudioVisualAnnotationSummary,
} from '@/data/core';

export interface PendingQuestion {
	question: string;
	options: Array< { label: string; description: string; image?: string } >;
}

export interface SendMessageOptions {
	displayMessage?: string;
	images?: StudioChatImage[];
	files?: StudioChatFileAttachment[];
	visualAnnotations?: StudioVisualAnnotationSummary[];
}

export interface QueuedPrompt extends SendMessageOptions {
	id: string;
	prompt: string;
}

// `starting` means the prompt was submitted and the subprocess run id is being created.
// `running` means the agent loop is working (thinking indicator shown).
// `winding_down` means the turn completed, but the subprocess is still draining.
// `idle` means no active run.
type RunPhase = 'idle' | 'starting' | 'running' | 'winding_down';

export interface AgentRunState {
	phase: RunPhase;
	runId: string | null;
	startedAt: number | null;
	isInterrupting: boolean;
	pendingQuestions: PendingQuestion[];
	pendingAnswers: Record< string, string >;
	queuedPrompts: QueuedPrompt[];
}

export const initialAgentRunState: AgentRunState = {
	phase: 'idle',
	runId: null,
	startedAt: null,
	isInterrupting: false,
	pendingQuestions: [],
	pendingAnswers: {},
	queuedPrompts: [],
};

export type AgentRunAction =
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

function resolveRunStartedAt( state: AgentRunState, runId: string, startedAt: number ): number {
	if ( state.phase === 'starting' || state.runId === runId ) {
		return state.startedAt ?? startedAt;
	}
	return startedAt;
}

function agentRunReducer( state: AgentRunState, action: AgentRunAction ): AgentRunState {
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
				...initialAgentRunState,
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

export function hasUnansweredQuestion( state: AgentRunState ): boolean {
	return state.pendingQuestions.some(
		( pendingQuestion ) => typeof state.pendingAnswers[ pendingQuestion.question ] !== 'string'
	);
}

type StatesBySession = Record< string, AgentRunState >;

// External store instead of useReducer state so per-session hooks can
// subscribe with `useSyncExternalStore` and re-render only when their own
// session's slice changes — a streaming tick for one session must not
// re-render every sidebar row.
export interface SessionStateStore {
	getState: () => StatesBySession;
	dispatch: ( sessionId: string, action: AgentRunAction ) => void;
	subscribe: ( listener: () => void ) => () => void;
}

export function createSessionStateStore(): SessionStateStore {
	let state: StatesBySession = {};
	const listeners = new Set< () => void >();
	return {
		getState: () => state,
		dispatch: ( sessionId, action ) => {
			const previous = state[ sessionId ] ?? initialAgentRunState;
			const next = agentRunReducer( previous, action );
			if ( next === previous ) {
				return;
			}
			state = { ...state, [ sessionId ]: next };
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
