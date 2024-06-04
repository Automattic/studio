import { useState, useEffect } from 'react';

export interface Message {
	content: string;
	role: 'user' | 'assistant';
}

export const useAssistant = ( selectedSiteId: string ) => {
	const [ messages, setMessages ] = useState< Message[] >( [] );

	useEffect( () => {
		const storedChat = localStorage.getItem( selectedSiteId );
		if ( storedChat ) {
			setMessages( JSON.parse( storedChat ) );
		} else {
			localStorage.setItem( selectedSiteId, JSON.stringify( [] ) );
		}
	}, [ selectedSiteId ] );

	const addMessage = ( content: string, role: 'user' | 'assistant' ) => {
		setMessages( ( prevMessages ) => {
			const updatedMessages = [ ...prevMessages, { content, role } ];
			localStorage.setItem( selectedSiteId, JSON.stringify( updatedMessages ) );
			return updatedMessages;
		} );
	};

	const clearMessages = () => {
		setMessages( [] );
		localStorage.setItem( selectedSiteId, JSON.stringify( [] ) );
	};

	return { messages, addMessage, clearMessages };
};
