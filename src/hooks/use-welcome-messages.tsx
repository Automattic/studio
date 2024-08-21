import * as Sentry from '@sentry/electron/renderer';
import {
	createContext,
	useEffect,
	useMemo,
	useRef,
	useState,
	useCallback,
	useContext,
} from 'react';
import { useAuth } from './use-auth';
import { useOffline } from './use-offline';
import { useWindowListener } from './use-window-listener';

interface WelcomeMessageResponse {
	messages: string[];
	example_prompts: string[];
}

interface WelcomeMessagesContext {
	messages: string[];
	examplePrompts: string[];
}

const WelcomeMessagesContext = createContext< WelcomeMessagesContext >( {
	messages: [],
	examplePrompts: [],
} );

export const WelcomeMessagesProvider = ( { children }: { children: React.ReactNode } ) => {
	const { client } = useAuth();
	const isOffline = useOffline();
	const [ messages, setMessages ] = useState< string[] >( [] );
	const [ examplePrompts, setExamplePrompts ] = useState< string[] >( [] );
	const isFetchingMessages = useRef( false );

	const fetchMessages = useCallback( async () => {
		if ( ! client?.req || isFetchingMessages.current || isOffline ) {
			return;
		}
		isFetchingMessages.current = true;
		try {
			const response = await client.req.get( {
				path: '/studio-app/ai-assistant/welcome',
				apiNamespace: 'wpcom/v2',
			} );
			const data = response as WelcomeMessageResponse;
			if ( data ) {
				setMessages( data.messages );
				setExamplePrompts( data.example_prompts );
			}
		} catch ( error ) {
			Sentry.captureException( error );
			console.error( error );
		} finally {
			isFetchingMessages.current = false;
		}
	}, [ client, isOffline ] );

	useEffect( () => {
		fetchMessages();
	}, [ fetchMessages, isOffline ] );

	useWindowListener( 'focus', () => {
		fetchMessages();
	} );

	const context = useMemo< WelcomeMessagesContext >(
		() => ( {
			messages,
			examplePrompts,
		} ),
		[ messages, examplePrompts ]
	);

	return (
		<WelcomeMessagesContext.Provider value={ context }>
			{ children }
		</WelcomeMessagesContext.Provider>
	);
};

export const useWelcomeMessages = () => useContext( WelcomeMessagesContext );
