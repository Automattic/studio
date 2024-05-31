import * as Sentry from '@sentry/electron/renderer';
import { useState, useEffect, useCallback } from 'react';
import { LIMIT_OF_PROMPTS_PER_USER } from '../constants';
import { useAuth } from './use-auth';

interface Message {
	content: string;
	role: 'user' | 'assistant';
}

export const usePromptUsage = () => {
	const [ promptLimit, setPromptLimit ] = useState( LIMIT_OF_PROMPTS_PER_USER );
	const [ promptCount, setPromptCount ] = useState( 0 );
	const { client } = useAuth();

	const fetchPromptUsage = useCallback( async () => {
		if ( ! client?.req ) {
			return;
		}
		try {
			return await new Promise( ( resolve, reject ) => {
				client.req.get(
					{
						method: 'HEAD',
						path: '/studio-app/ai-assistant/chat',
						apiNamespace: 'wpcom/v2',
					},
					( error: Error, _data: unknown, headers: Record< string, string > ) => {
						if ( error ) {
							reject( error );
						}
						const limit = parseInt( headers[ 'x-ratelimit-limit' ] );
						const remaining = parseInt( headers[ 'x-ratelimit-remaining' ] );
						if ( isNaN( limit ) || isNaN( remaining ) ) {
							reject( new Error( 'Error fetching limit response' ) );
						}
						setPromptLimit( limit );
						setPromptCount( limit - remaining );
						resolve( headers );
					}
				);
			} );
		} catch ( error ) {
			Sentry.captureException( error );
			console.error( error );
		}
	}, [ client ] );

	useEffect( () => {
		if ( ! client ) {
			return;
		}
		fetchPromptUsage();
	}, [ fetchPromptUsage, client ] );

	return { promptLimit, promptCount };
};
