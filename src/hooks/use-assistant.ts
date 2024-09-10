import { useState, useEffect, useCallback, useMemo, useRef } from 'react';

export type Message = {
	id?: number;
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

export type MessageDict = { [ key: string ]: Message[] };
export type ChatIdDict = { [ key: string ]: string | undefined };

const chatIdStoreKey = 'ai_chat_ids';
const chatMessagesStoreKey = 'ai_chat_messages';

export const useAssistant = ( instanceId: string ) => {
	const [ messagesDict, setMessagesDict ] = useState< MessageDict >( {} );
	const [ chatIdDict, setChatIdDict ] = useState< ChatIdDict >( {
		[ instanceId ]: undefined,
	} );
	const nextMessageIdRef = useRef< { [ key: string ]: number } >( {
		[ instanceId ]: -1, // The first message should have id 0, as we do +1 when we add message
	} );

	useEffect( () => {
		const storedMessages = localStorage.getItem( chatMessagesStoreKey );
		const storedChatIds = localStorage.getItem( chatIdStoreKey );

		if ( storedMessages ) {
			const parsedMessages: MessageDict = JSON.parse( storedMessages );
			setMessagesDict( parsedMessages );
			Object.entries( parsedMessages ).forEach( ( [ key, messages ] ) => {
				nextMessageIdRef.current[ key ] = messages.length;
			} );
		}
		if ( storedChatIds ) {
			setChatIdDict( JSON.parse( storedChatIds ) );
		}
	}, [] );

	const addMessage = useCallback(
		( content: string, role: 'user' | 'assistant', chatId?: string ) => {
			const newMessageId = nextMessageIdRef.current[ instanceId ] + 1;
			nextMessageIdRef.current[ instanceId ] = newMessageId;

			setMessagesDict( ( prevDict ) => {
				const prevMessages = prevDict[ instanceId ] || [];
				const updatedMessages = [
					...prevMessages,
					{ content, role, id: newMessageId, chatId, createdAt: Date.now() },
				];
				const newDict = { ...prevDict, [ instanceId ]: updatedMessages };
				localStorage.setItem( chatMessagesStoreKey, JSON.stringify( newDict ) );
				return newDict;
			} );

			setChatIdDict( ( prevDict ) => {
				if ( prevDict[ instanceId ] !== chatId && chatId ) {
					const newDict = { ...prevDict, [ instanceId ]: chatId };
					localStorage.setItem( chatIdStoreKey, JSON.stringify( newDict ) );
					return newDict;
				}
				return prevDict;
			} );

			return newMessageId; // Return the new message ID
		},
		[ instanceId ]
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
				localStorage.setItem( chatMessagesStoreKey, JSON.stringify( newDict ) );
				return newDict;
			} );
		},
		[ instanceId ]
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
				localStorage.setItem( chatMessagesStoreKey, JSON.stringify( newDict ) );
				return newDict;
			} );
		},
		[ instanceId ]
	);

	const markMessageAsFeedbackReceived = useCallback(
		( id: number, feedbackReceived: boolean ) => {
			setMessagesDict( ( prevDict ) => {
				const prevMessages = prevDict[ instanceId ] || [];

				// Add logging to debug
				console.log( 'Clicked message id: ', id );
				prevMessages.forEach( ( message ) => {
					console.log( 'Message being checked id: ', message.id );
				} );

				const updatedMessages = prevMessages.map( ( message ) => {
					if ( message.id !== id ) return message;
					return { ...message, feedbackReceived };
				} );

				const newDict = { ...prevDict, [ instanceId ]: updatedMessages };
				localStorage.setItem( chatMessagesStoreKey, JSON.stringify( newDict ) );
				return newDict;
			} );
		},
		[ instanceId ]
	);

	const clearMessages = useCallback( () => {
		setMessagesDict( ( prevDict ) => {
			const { [ instanceId ]: _, ...rest } = prevDict;
			localStorage.setItem( chatMessagesStoreKey, JSON.stringify( rest ) );
			return rest;
		} );

		setChatIdDict( ( prevDict ) => {
			const { [ instanceId ]: _, ...rest } = prevDict;
			localStorage.setItem( chatIdStoreKey, JSON.stringify( rest ) );
			return rest;
		} );
		nextMessageIdRef.current[ instanceId ] = 0;
	}, [ instanceId ] );

	return useMemo(
		() => ( {
			messages: messagesDict[ instanceId ] || [],
			addMessage,
			updateMessage,
			clearMessages,
			chatId: chatIdDict[ instanceId ],
			markMessageAsFailed,
			markMessageAsFeedbackReceived,
		} ),
		[
			messagesDict,
			instanceId,
			addMessage,
			updateMessage,
			clearMessages,
			chatIdDict,
			markMessageAsFailed,
			markMessageAsFeedbackReceived,
		]
	);
};
