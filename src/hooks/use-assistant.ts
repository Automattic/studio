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

export const useAssistant = ( selectedSiteId: string ) => {
	const [ messages, setMessages ] = useState< Message[] >( [] );
    const [ chatId, setChatId ] = useState< string | undefined >( undefined );

	useEffect( () => {
		const storedChat = localStorage.getItem( selectedSiteId );
		const storedChatId = localStorage.getItem( `chat_${ selectedSiteId }` );
		if ( storedChat ) {
			setMessages( JSON.parse( storedChat ) );
		} else {
			localStorage.setItem( selectedSiteId, JSON.stringify( [] ) );
		}
		if ( storedChatId ) {
			setChatId( storedChatId );
		}
	}, [ selectedSiteId ] );

	const addMessage = useCallback(
		( content: string, role: 'user' | 'assistant', chatId?: string  ) => {
			setMessages( ( prevMessages ) => {
				const updatedMessages = [ ...prevMessages, { content, role, id: prevMessages.length } ];
				localStorage.setItem( selectedSiteId, JSON.stringify( updatedMessages ) );
				return updatedMessages;
			} );

                    setChatId( ( prevChatId ) => {
			if ( prevChatId !== chatId && chatId ) {
				localStorage.setItem( `chat_${ selectedSiteId }`, JSON.stringify( chatId ) );
			}
			return chatId;
		} );
		},
		[ selectedSiteId ]
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
				localStorage.setItem( selectedSiteId, JSON.stringify( updatedMessages ) );
				return updatedMessages;
			} );
		},
		[ selectedSiteId ]
	);
	const clearMessages = () => {
		setMessages( [] );
		setChatId( undefined );
		localStorage.setItem( selectedSiteId, JSON.stringify( [] ) );
		localStorage.removeItem( `chat_${ selectedSiteId }` );
	};

    	const clearMessages = useCallback( () => {
	setMessages( [] );
		setChatId( undefined );
		localStorage.setItem( selectedSiteId, JSON.stringify( [] ) );
		localStorage.removeItem( `chat_${ selectedSiteId }` );
	}, [ selectedSiteId ] );
    
	return useMemo(
		() => ( {
			messages,
			addMessage,
			updateMessage,
			clearMessages,
            chatId
		} ),
		[ addMessage, clearMessages, messages, updateMessage, chatId ]
	);
};