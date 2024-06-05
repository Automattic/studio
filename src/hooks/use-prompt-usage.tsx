import * as Sentry from '@sentry/electron/renderer';
import { useState, useEffect, useCallback, useMemo, createContext, useContext } from 'react';
import { LIMIT_OF_PROMPTS_PER_USER } from '../constants';
import { getAppGlobals } from '../lib/app-globals';
import { useAuth } from './use-auth';

type PromptUsage = {
	promptLimit: number;
	promptCount: number;
	fetchPromptUsage: () => Promise< void >;
	updatePromptUsage: ( headers: Record< string, string > ) => void;
};

const initState = {
	promptLimit: LIMIT_OF_PROMPTS_PER_USER,
	promptCount: 0,
	fetchPromptUsage: async () => undefined,
	updatePromptUsage: ( _headers: Record< string, string > ) => undefined,
};
const promptUsageContext = createContext< PromptUsage >( initState );

interface PromptUsageProps {
	children?: React.ReactNode;
}

export function usePromptUsage() {
	return useContext( promptUsageContext );
}

export function PromptUsageProvider( { children }: PromptUsageProps ) {
	const { Provider } = promptUsageContext;
	const assistantEnabled = getAppGlobals().assistantEnabled;

	const [ initiated, setInitiated ] = useState( false );
	const [ promptLimit, setPromptLimit ] = useState( LIMIT_OF_PROMPTS_PER_USER );
	const [ promptCount, setPromptCount ] = useState( 0 );
	const { client } = useAuth();

	const updatePromptUsage = useCallback(
		( headers: Record< string, string > ) => {
			const limit = parseInt( headers[ 'x-ratelimit-limit' ] );
			const remaining = parseInt( headers[ 'x-ratelimit-remaining' ] );
			if ( isNaN( limit ) || isNaN( remaining ) ) {
				return;
			}
			setPromptLimit( limit );
			setPromptCount( limit - remaining );
			if ( ! initiated ) {
				setInitiated( true );
			}
		},
		[ initiated ]
	);

	const fetchPromptUsage = useCallback( async () => {
		if ( ! client?.req || ! assistantEnabled ) {
			return;
		}
		try {
			await new Promise( ( resolve, reject ) => {
				client.req.get(
					{
						method: 'HEAD',
						path: '/studio-app/ai-assistant/chat',
						apiNamespace: 'wpcom/v2',
					},
					( error: Error, _data: unknown, headers: Record< string, string > ) => {
						if ( error ) {
							return reject( error );
						}
						if ( ! headers ) {
							reject( new Error( 'No headers in response' ) );
							return;
						}
						updatePromptUsage( headers );
						resolve( headers );
					}
				);
			} );
		} catch ( error ) {
			Sentry.captureException( error );
			console.error( error );
		}
	}, [ assistantEnabled, client, updatePromptUsage ] );

	useEffect( () => {
		if ( ! client || initiated ) {
			return;
		}
		fetchPromptUsage();
	}, [ fetchPromptUsage, client, initiated ] );

	const contextValue = useMemo( () => {
		return {
			fetchPromptUsage,
			promptLimit,
			promptCount,
			updatePromptUsage,
		};
	}, [ fetchPromptUsage, promptLimit, promptCount, updatePromptUsage ] );

	return <Provider value={ contextValue }>{ children }</Provider>;
}
