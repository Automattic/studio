import { useState, useEffect, useCallback, useMemo } from 'react';

export type Message = {
	id?: number;
	content: string;
	role: 'user' | 'assistant';
	blocks?: {
		cliOutput?: string;
		cliStatus?: 'success' | 'error';
		cliTime?: string;
		codeBlockContent?: string;
	}[];
};

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

	const addMessage = useCallback(
		( content: string, role: 'user' | 'assistant' ) => {
			setMessages( ( prevMessages ) => {
				const updatedMessages = [ ...prevMessages, { content, role, id: prevMessages.length } ];
				localStorage.setItem( selectedSiteId, JSON.stringify( updatedMessages ) );
				return updatedMessages;
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

	const clearMessages = useCallback( () => {
		setMessages( [] );
		localStorage.setItem( selectedSiteId, JSON.stringify( [] ) );
	}, [ selectedSiteId ] );

	return useMemo(
		() => ( {
			messages,
			addMessage,
			updateMessage,
			clearMessages,
		} ),
		[ addMessage, clearMessages, messages, updateMessage ]
	);
};
