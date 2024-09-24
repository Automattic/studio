import React, { createContext, useContext, useMemo, useRef, useCallback, ReactNode } from 'react';

export interface ChatInputContextType {
	getChatInput: ( siteId: string ) => string;
	saveChatInput: ( input: string, siteId: string ) => void;
}

interface ChatInputProviderProps {
	children: ReactNode;
}

const ChatInputContext = createContext< ChatInputContextType >( {
	getChatInput: () => '',
	saveChatInput: () => {
		// NOOP
	},
} );

export const ChatInputProvider: React.FC< ChatInputProviderProps > = ( { children } ) => {
	const inputBySite = useRef< Record< string, string > >( {} );

	const getChatInput = useCallback( ( siteId: string ) => {
		return inputBySite.current[ siteId ] ?? '';
	}, [] );

	const saveChatInput = useCallback( ( input: string, siteId: string ) => {
		inputBySite.current[ siteId ] = input;
	}, [] );

	const contextValue = useMemo( () => {
		return {
			getChatInput,
			saveChatInput,
		};
	}, [ getChatInput, saveChatInput ] );

	return <ChatInputContext.Provider value={ contextValue }>{ children }</ChatInputContext.Provider>;
};

export const useChatInputContext = (): ChatInputContextType => {
	const context = useContext( ChatInputContext );
	if ( ! context ) {
		throw new Error( 'useChatInputContext must be used within a ChatInputProvider' );
	}
	return context;
};
