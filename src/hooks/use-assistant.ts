import { useState, useEffect } from 'react';

export interface Message {
	content: string;
	role: 'user' | 'assistant';
}

export const useAssistant = ( selectedSiteId: string ) => {
	const [ messages, setMessages ] = useState< Message[] >( [] );
	const [ chatId, setChatId ] = useState< string | null >( null );

	useEffect( () => {
		const storedChat = localStorage.getItem( selectedSiteId );
		if ( storedChat ) {
			const chat = JSON.parse( storedChat );
			setMessages( chat.messages );
			setChatId( chat.chatId );
		} else {
			localStorage.setItem(
				selectedSiteId,
				JSON.stringify( {
					messages: [],
					chatId: null,
				} )
			);
		}
	}, [ selectedSiteId ] );

	const addMessage = ( content: string, role: 'user' | 'assistant', chatId: string | null ) => {
		setMessages( ( prevMessages ) => {
			const updatedMessages = [ ...prevMessages, { content, role } ];
			localStorage.setItem(
				selectedSiteId,
				JSON.stringify( {
					messages: updatedMessages,
					chatId,
				} )
			);
			return updatedMessages;
		} );
	};

	const clearMessages = () => {
		setMessages( [] );
		localStorage.setItem(
			selectedSiteId,
			JSON.stringify( {
				messages: [],
				chatId: null,
			} )
		);
	};

	return { messages, chatId, addMessage, clearMessages };
};
