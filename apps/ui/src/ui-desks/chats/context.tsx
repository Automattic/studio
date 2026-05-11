import { createContext, useContext } from 'react';
import type { ReactNode } from 'react';

export interface ChatPromptRequest {
	prompt: string;
	displayMessage?: string;
}

export interface PendingChatPrompt extends Required< ChatPromptRequest > {
	id: string;
	sessionId: string;
}

export interface ChatsContextValue {
	open: boolean;
	setOpen: ( open: boolean ) => void;
	selectedSessionId?: string;
	expanded: boolean;
	autoFocusSessionId?: string;
	isCreatingChat: boolean;
	pendingPrompt?: PendingChatPrompt;
	selectSession: ( sessionId: string ) => void;
	switchSession: ( sessionId: string ) => void;
	clearSelection: () => void;
	startNewChat: () => Promise< void >;
	startChatWithPrompt: ( request: ChatPromptRequest ) => Promise< void >;
	consumePendingPrompt: ( promptId: string ) => void;
}

export interface ChatsProviderProps {
	siteId?: string;
	children: ReactNode;
}

const defaultChatsContext: ChatsContextValue = {
	open: false,
	setOpen: noopSetOpen,
	selectedSessionId: undefined,
	expanded: false,
	autoFocusSessionId: undefined,
	isCreatingChat: false,
	pendingPrompt: undefined,
	selectSession: noopSelectSession,
	switchSession: noopSelectSession,
	clearSelection: noopClearSelection,
	startNewChat: noopStartChat,
	startChatWithPrompt: noopStartChatWithPrompt,
	consumePendingPrompt: noopConsumePendingPrompt,
};

export const ChatsContext = createContext< ChatsContextValue >( defaultChatsContext );

export function useChats() {
	return useContext( ChatsContext );
}

function noopSetOpen() {}
function noopSelectSession() {}
function noopClearSelection() {}
async function noopStartChat() {}
async function noopStartChatWithPrompt() {}
function noopConsumePendingPrompt() {}
