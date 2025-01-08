import { useCallback } from 'react';
import { CHAT_MESSAGES_STORE_KEY } from '../constants';
import { CHAT_ID_STORE_KEY, useChatContext } from './use-chat-context';
import { useSendFeedback } from './use-send-feedback';

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
	const { messagesDict, setMessagesDict, chatIdDict, setChatIdDict, lastMessageIdDictRef } =
		useChatContext();
	const chatId = chatIdDict[ instanceId ];

	const addMessage = useCallback(
		( content: string, role: 'user' | 'assistant', chatId?: string, messageApiId?: number ) => {
			if ( lastMessageIdDictRef.current[ instanceId ] === undefined ) {
				lastMessageIdDictRef.current[ instanceId ] = -1;
			}

			const newMessageId = lastMessageIdDictRef.current[ instanceId ] + 1;
			lastMessageIdDictRef.current[ instanceId ] = newMessageId;

			setMessagesDict( ( prevDict ) => {
				const prevMessages = prevDict[ instanceId ] || [];
				const updatedMessages = [
					...prevMessages,
					{
						content,
						role,
						id: newMessageId,
						chatId,
						createdAt: Date.now(),
						feedbackReceived: false,
						messageApiId,
					},
				];
				const newDict = { ...prevDict, [ instanceId ]: updatedMessages };
				localStorage.setItem( CHAT_MESSAGES_STORE_KEY, JSON.stringify( newDict ) );
				return newDict;
			} );

			setChatIdDict( ( prevDict ) => {
				if ( prevDict[ instanceId ] !== chatId && chatId ) {
					const newDict = { ...prevDict, [ instanceId ]: chatId };
					localStorage.setItem( CHAT_ID_STORE_KEY, JSON.stringify( newDict ) );
					return newDict;
				}
				return prevDict;
			} );

			return newMessageId; // Return the new message ID
		},
		[ instanceId, setMessagesDict, setChatIdDict, lastMessageIdDictRef ]
	);

	const updateMessage = useCallback(
		(
			id: number,
			codeBlockContent: string,
			cliOutput?: string,
			cliStatus?: 'success' | 'error',
			cliTime?: string
		) => {
			setMessagesDict( ( prevDict ) => {
				const prevMessages = prevDict[ instanceId ] || [];
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
				const newDict = { ...prevDict, [ instanceId ]: updatedMessages };
				localStorage.setItem( CHAT_MESSAGES_STORE_KEY, JSON.stringify( newDict ) );
				return newDict;
			} );
		},
		[ instanceId, setMessagesDict ]
	);

	const markMessageAsFailed = useCallback(
		( id: number, failedMessage: boolean ) => {
			setMessagesDict( ( prevDict ) => {
				const prevMessages = prevDict[ instanceId ] || [];
				const updatedMessages = prevMessages.map( ( message ) => {
					if ( message.id !== id ) return message;
					return { ...message, failedMessage };
				} );
				const newDict = { ...prevDict, [ instanceId ]: updatedMessages };
				localStorage.setItem( CHAT_MESSAGES_STORE_KEY, JSON.stringify( newDict ) );
				return newDict;
			} );
		},
		[ instanceId, setMessagesDict ]
	);

	const sendFeedback = useSendFeedback();

	const markMessageAsFeedbackReceived = useCallback(
		async ( messageRemoteId: number, feedback: number ) => {
			if ( ! messageRemoteId || ! chatId ) {
				return;
			}
			setMessagesDict( ( prevDict ) => {
				const prevMessages = prevDict[ instanceId ] || [];

				const updatedMessages = prevMessages.map( ( message ) => {
					if ( message.messageApiId === messageRemoteId ) {
						return { ...message, feedbackReceived: true };
					}
					return message;
				} );

				const newDict = { ...prevDict, [ instanceId ]: updatedMessages };
				localStorage.setItem( CHAT_MESSAGES_STORE_KEY, JSON.stringify( newDict ) );

				return newDict;
			} );

			try {
				await sendFeedback( {
					chatId,
					messageId: messageRemoteId,
					ratingValue: feedback,
				} );
			} catch ( error ) {
				console.error( 'Failed to submit feedback:', error );
			}
		},
		[ chatId, instanceId, sendFeedback ]
	);

	const clearMessages = useCallback( () => {
		setMessagesDict( ( prevDict ) => {
			const { [ instanceId ]: _, ...rest } = prevDict;
			localStorage.setItem( CHAT_MESSAGES_STORE_KEY, JSON.stringify( rest ) );
			return rest;
		} );

		setChatIdDict( ( prevDict ) => {
			const { [ instanceId ]: _, ...rest } = prevDict;
			localStorage.setItem( CHAT_ID_STORE_KEY, JSON.stringify( rest ) );
			return rest;
		} );
		lastMessageIdDictRef.current[ instanceId ] = -1;
	}, [ instanceId, setMessagesDict, setChatIdDict ] );

	return {
		messages: messagesDict[ instanceId ] || EMPTY_MESSAGES,
		addMessage,
		updateMessage,
		clearMessages,
		chatId: chatIdDict[ instanceId ],
		markMessageAsFailed,
		markMessageAsFeedbackReceived,
	};
};
