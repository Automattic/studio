import { useState, useEffect } from 'react';

export interface Message {
	content: string;
	role: 'user' | 'assistant';
	chatId?: string;
}

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

	const addMessage = ( content: string, role: 'user' | 'assistant', chatId?: string ) => {
		setMessages( ( prevMessages ) => {
			const updatedMessages = [ ...prevMessages, { content, role } ];
			localStorage.setItem( selectedSiteId, JSON.stringify( updatedMessages ) );
			return updatedMessages;
		} );
		setChatId( ( prevChatId ) => {
			if ( prevChatId !== chatId && chatId ) {
				localStorage.setItem( `chat_${ selectedSiteId }`, JSON.stringify( chatId ) );
			}
			return chatId;
		} );
	};

	const clearMessages = () => {
		setMessages( [] );
		setChatId( undefined );
		localStorage.setItem( selectedSiteId, JSON.stringify( [] ) );
		localStorage.removeItem( `chat_${ selectedSiteId }` );
	};

	return { messages, addMessage, clearMessages, chatId };
};
