import { useCallback } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { RootState } from 'src/stores';
import { setMessages, selectMessages, selectChatId } from 'src/stores/chat-slice';

export type Message = {
	id?: number;
	messageApiId?: number;
	content: string;
	role: 'user' | 'assistant';
	chatId?: string;
	blocks?: {
		cliOutput?: string;
		cliStatus?: 'success' | 'error';
		cliTime?: string;
		codeBlockContent?: string;
	}[];
	createdAt: number; // Unix timestamp
	failedMessage?: boolean;
	feedbackReceived?: boolean;
};

const EMPTY_MESSAGES: Message[] = [];

export const useAssistant = ( instanceId: string ) => {
	const dispatch = useDispatch();
	const prevMessages = useSelector( ( state: RootState ) => selectMessages( state, instanceId ) );
	const prevChatId = useSelector( ( state: RootState ) => selectChatId( state, instanceId ) );

	const updateMessage = useCallback(
		(
			id: number,
			codeBlockContent: string,
			cliOutput?: string,
			cliStatus?: 'success' | 'error',
			cliTime?: string
		) => {
			const updatedMessages = prevMessages.map( ( message ) => {
				if ( message.id !== id ) return message;
				const updatedBlocks = ( message.blocks || [] ).map( ( block ) =>
					block.codeBlockContent === codeBlockContent
						? { ...block, cliOutput, cliStatus, cliTime }
						: block
				);
				const isBlockUpdated = updatedBlocks.find(
					( block ) => block.codeBlockContent === codeBlockContent
				);
				if ( ! isBlockUpdated ) {
					updatedBlocks.push( { codeBlockContent, cliOutput, cliStatus, cliTime } );
				}
				return { ...message, blocks: updatedBlocks };
			} );
			dispatch( setMessages( { siteId: instanceId, messages: updatedMessages } ) );
		},
		[ instanceId, prevMessages, dispatch ]
	);

	return {
		messages: prevMessages || EMPTY_MESSAGES,
		updateMessage,
		chatId: prevChatId,
	};
};
