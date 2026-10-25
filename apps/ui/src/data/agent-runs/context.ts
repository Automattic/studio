import { createContext, useContext } from 'react';
import type { AgentRunAction, SendMessageOptions, SessionStateStore } from './store';

export interface AgentRunStore {
	stateStore: SessionStateStore;
	dispatchSession: ( sessionId: string, action: AgentRunAction ) => void;
	startRun: ( sessionId: string, prompt: string, options?: SendMessageOptions ) => Promise< void >;
	interrupt: ( sessionId: string ) => Promise< void >;
	answerQuestion: ( sessionId: string, question: string, answer: string ) => void;
	clearQuestionAnswer: ( sessionId: string, question: string ) => void;
}

export const AgentRunContext = createContext< AgentRunStore | null >( null );

export function useAgentRunStore(): AgentRunStore {
	const store = useContext( AgentRunContext );
	if ( ! store ) {
		throw new Error( 'Agent run hooks must be used within AgentRunProvider' );
	}
	return store;
}
