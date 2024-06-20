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
};

export const useAssistant = ( storeKey: string ) => {
	const [ messages, setMessages ] = useState< Message[] >( [] );
	const [ chatId, setChatId ] = useState< string | undefined >( undefined );

	useEffect( () => {
		const storedChat = localStorage.getItem( storeKey );
		const storedChatId = localStorage.getItem( `chat_${ storeKey }` );
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
	}, [ storeKey ] );

	const addMessage = useCallback(
		( content: string, role: 'user' | 'assistant', chatId?: string ) => {
			setMessages( ( prevMessages ) => {
				const updatedMessages = [ ...prevMessages, { content, role, id: prevMessages.length } ];
				localStorage.setItem( storeKey, JSON.stringify( updatedMessages ) );
				return updatedMessages;
			} );

			setChatId( ( prevChatId ) => {
				if ( prevChatId !== chatId && chatId ) {
					localStorage.setItem( `chat_${ storeKey }`, JSON.stringify( chatId ) );
				}
				return chatId;
			} );
		},
		[ storeKey ]
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
				localStorage.setItem( storeKey, JSON.stringify( updatedMessages ) );
				return updatedMessages;
			} );
		},
		[ storeKey ]
	);

	const clearMessages = useCallback( () => {
		setMessages( [] );
		setChatId( undefined );
		localStorage.setItem( storeKey, JSON.stringify( [] ) );
		localStorage.removeItem( `chat_${ storeKey }` );
	}, [ storeKey ] );

	return useMemo(
		() => ( {
			messages,
			addMessage,
			updateMessage,
			clearMessages,
			chatId,
		} ),
		[ addMessage, clearMessages, messages, updateMessage, chatId ]
	);
};
