import { createContext, useContext } from 'react';
import type { DeskWidget } from '@/ui-desks/widgets/types';
import type { ReactNode } from 'react';

export interface ChatPromptRequest {
	prompt: string;
	displayMessage?: string;
}

export interface PendingChatPrompt extends Required< ChatPromptRequest > {
	id: string;
	sessionId: string;
}

export interface ComposerWidgetAttachmentRequest {
	id: string;
	sessionId: string;
	widgets: DeskWidget[];
}

export interface ComposerWidgetDragPreview {
	widgets: DeskWidget[];
	x: number;
	y: number;
}

export interface ChatsContextValue {
	open: boolean;
	setOpen: ( open: boolean ) => void;
	selectedSessionId?: string;
	expanded: boolean;
	autoFocusSessionId?: string;
	isCreatingChat: boolean;
	pendingPrompt?: PendingChatPrompt;
	composerWidgetAttachmentRequest?: ComposerWidgetAttachmentRequest;
	composerWidgetDragPreview?: ComposerWidgetDragPreview;
	isComposerWidgetDragTarget: boolean;
	selectSession: ( sessionId: string ) => void;
	switchSession: ( sessionId: string ) => void;
	clearSelection: () => void;
	startNewChat: () => Promise< void >;
	startChatWithPrompt: ( request: ChatPromptRequest ) => Promise< void >;
	consumePendingPrompt: ( promptId: string ) => void;
	attachWidgetsToComposer: ( widgets: DeskWidget[] ) => void;
	consumeComposerWidgetAttachmentRequest: ( requestId: string ) => void;
	setComposerWidgetDragPreview: ( preview: ComposerWidgetDragPreview | undefined ) => void;
	setComposerWidgetDragTarget: ( isTarget: boolean ) => void;
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
	composerWidgetAttachmentRequest: undefined,
	composerWidgetDragPreview: undefined,
	isComposerWidgetDragTarget: false,
	selectSession: noopSelectSession,
	switchSession: noopSelectSession,
	clearSelection: noopClearSelection,
	startNewChat: noopStartChat,
	startChatWithPrompt: noopStartChatWithPrompt,
	consumePendingPrompt: noopConsumePendingPrompt,
	attachWidgetsToComposer: noopAttachWidgetsToComposer,
	consumeComposerWidgetAttachmentRequest: noopConsumePendingPrompt,
	setComposerWidgetDragPreview: noopSetComposerWidgetDragPreview,
	setComposerWidgetDragTarget: noopSetComposerWidgetDragTarget,
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
function noopAttachWidgetsToComposer() {}
function noopSetComposerWidgetDragPreview() {}
function noopSetComposerWidgetDragTarget() {}
