import { createContext, useContext } from 'react';
import type { ReactNode } from 'react';

export interface DeskChatPromptRequest {
	prompt: string;
	displayMessage?: string;
}

export interface PendingDeskChatPrompt extends Required< DeskChatPromptRequest > {
	id: string;
	sessionId: string;
}

export interface DeskChatsContextValue {
	open: boolean;
	setOpen: ( open: boolean ) => void;
	selectedSessionId?: string;
	expanded: boolean;
	autoFocusSessionId?: string;
	isCreatingChat: boolean;
	pendingPrompt?: PendingDeskChatPrompt;
	selectSession: ( sessionId: string ) => void;
	switchSession: ( sessionId: string ) => void;
	clearSelection: () => void;
	startNewChat: () => Promise< void >;
	startChatWithPrompt: ( request: DeskChatPromptRequest ) => Promise< void >;
	consumePendingPrompt: ( promptId: string ) => void;
}

export interface DeskChatsProviderProps {
	siteId?: string;
	children: ReactNode;
}

const defaultDeskChatsContext: DeskChatsContextValue = {
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

export const DeskChatsContext = createContext< DeskChatsContextValue >( defaultDeskChatsContext );

export function useDeskChats() {
	return useContext( DeskChatsContext );
}

function noopSetOpen() {}
function noopSelectSession() {}
function noopClearSelection() {}
async function noopStartChat() {}
async function noopStartChatWithPrompt() {}
function noopConsumePendingPrompt() {}
