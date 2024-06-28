import { useState, useEffect, useCallback, useMemo } from 'react';

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
};

const chatIdStoreKey = ( instanceId: string ) => `ai_chat_id_${ instanceId }`;
const chatMessagesStoreKey = ( instanceId: string ) => `ai_chat_messages_${ instanceId }`;

export const useAssistant = ( instanceId: string ) => {
	const [ messages, setMessages ] = useState< Message[] >( [] );
	const [ chatId, setChatId ] = useState< string | undefined >( undefined );

	useEffect( () => {
		const storedChat = localStorage.getItem( chatMessagesStoreKey( instanceId ) );
		const storedChatId = localStorage.getItem( chatIdStoreKey( instanceId ) );
		if ( storedChat ) {
			setMessages( JSON.parse( storedChat ) );
		} else {
			setMessages( [] );
		}
		if ( storedChatId ) {
			setChatId( storedChatId );
		} else {
			setChatId( undefined );
		}
	}, [ instanceId ] );

	const addMessage = useCallback(
		( content: string, role: 'user' | 'assistant', chatId?: string ) => {
			let newMessageId;
			setMessages( ( prevMessages ) => {
				newMessageId = prevMessages.length; // Calculate the new message ID
				const updatedMessages = [
					...prevMessages,
					{ content, role, id: newMessageId, createdAt: Date.now() },
				];
				localStorage.setItem(
					chatMessagesStoreKey( instanceId ),
					JSON.stringify( updatedMessages )
				);
				return updatedMessages;
			} );

			setChatId( ( prevChatId ) => {
				if ( prevChatId !== chatId && chatId ) {
					localStorage.setItem( chatIdStoreKey( instanceId ), JSON.stringify( chatId ) );
				}
				return chatId;
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
			setMessages( ( prevMessages ) => {
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
				localStorage.setItem(
					chatMessagesStoreKey( instanceId ),
					JSON.stringify( updatedMessages )
				);
				return updatedMessages;
			} );
		},
		[ instanceId ]
	);

	const updateFailedMessage = useCallback(
		( id: number, failedMessage: boolean, role: 'user' | 'assistant' = 'user' ) => {
			setMessages( ( prevMessages ) => {
				const updatedMessages = prevMessages.map( ( message ) => {
					if ( message.id !== id ) return message;
					return { ...message, failedMessage, role };
				} );
				localStorage.setItem(
					chatMessagesStoreKey( instanceId ),
					JSON.stringify( updatedMessages )
				);
				return updatedMessages;
			} );
		},
		[ instanceId ]
	);

	const clearMessages = useCallback( () => {
		setMessages( [] );
		setChatId( undefined );
		localStorage.setItem( chatMessagesStoreKey( instanceId ), JSON.stringify( [] ) );
		localStorage.removeItem( chatIdStoreKey( instanceId ) );
	}, [ instanceId ] );

	return useMemo(
		() => ( {
			messages,
			addMessage,
			updateMessage,
			clearMessages,
			updateFailedMessage,
			chatId,
		} ),
		[ addMessage, clearMessages, messages, updateMessage, updateFailedMessage, chatId ]
	);
};
