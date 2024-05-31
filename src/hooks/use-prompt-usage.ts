import { useState, useEffect, useCallback } from 'react';
import { useAuth } from './use-auth';

interface Message {
	content: string;
	role: 'user' | 'assistant';
}

export const usePromptUsage = () => {
	const [ promptLimit, setPromptLimit ] = useState( 0 );
	const [ promptCount, setPromptCount ] = useState( 0 );
	const { client } = useAuth();

	const fetchPromptUsage = useCallback( async () => {
		if ( ! client?.req ) {
			return;
		}
		try {
			console.log( 'fetching prompt usage' );
			return new Promise( ( resolve, reject ) => {
				client.req.get(
					{
						method: 'HEAD',
						path: '/studio-app/ai-assistant/chat',
						apiNamespace: 'wpcom/v2',
					},
					( _err, _data, headers ) => {
						console.log( headers );
						console.log( headers[ 'X-Ratelimit-Limit' ] );
						console.log( headers[ 'X-Ratelimit-Remaining' ] );
						console.log( headers[ 'X-Ratelimit-Reset' ] );
						resolve( headers );
					}
				);
			} );
		} catch ( error ) {
			console.error( error );
		}
	}, [ client ] );

	useEffect( () => {
		if ( ! client ) {
			return;
		}
		const fetchStats = async () => {
			const response = await fetchPromptUsage();
			if ( ! response ) {
				//
			}
		};
		fetchStats();
	}, [ fetchPromptUsage, client ] );

	return { promptLimit, promptCount };
};
