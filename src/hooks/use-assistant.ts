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
};

export type MessageDict = { [ key: string ]: Message[] };
export type ChatIdDict = { [ key: string ]: string | undefined };

const chatIdStoreKey = 'ai_chat_ids';
const chatMessagesStoreKey = 'ai_chat_messages';

export const useAssistant = ( instanceId: string ) => {
	const [ messagesDict, setMessagesDict ] = useState< MessageDict >( {} );
	const [ chatIdDict, setChatIdDict ] = useState< ChatIdDict >( {} );

	useEffect( () => {
		const storedMessages = localStorage.getItem( chatMessagesStoreKey );
		const storedChatIds = localStorage.getItem( chatIdStoreKey );

		if ( storedMessages ) {
			setMessagesDict( JSON.parse( storedMessages ) );
		}
		if ( storedChatIds ) {
			setChatIdDict( JSON.parse( storedChatIds ) );
		}
	}, [] );

	const addMessage = useCallback(
		( content: string, role: 'user' | 'assistant', chatId?: string ) => {
			setMessagesDict( ( prevDict ) => {
				const prevMessages = prevDict[ instanceId ] || [];
				const updatedMessages = [
					...prevMessages,
					{ content, role, id: prevMessages.length, createdAt: Date.now() },
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
	}, [ instanceId ] );

	return useMemo(
		() => ( {
			messages: messagesDict[ instanceId ] || [],
			addMessage,
			updateMessage,
			clearMessages,
			chatId: chatIdDict[ instanceId ],
		} ),
		[ messagesDict, instanceId, addMessage, updateMessage, clearMessages, chatIdDict ]
	);
};
