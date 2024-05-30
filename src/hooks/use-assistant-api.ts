import { useCallback, useState } from 'react';
import { Message } from './use-assistant';
import { useAuth } from './use-auth';

export function useAssistantApi() {
	const { client } = useAuth();
	const [ isLoading, setIsLoading ] = useState( false );

	const fetchAssistant = useCallback(
		async ( messages: Message[] ) => {
			if ( ! client ) {
				throw new Error( 'WPcom client not initialized' );
			}
			setIsLoading( true );
			const body = {
				messages,
			};
			let response;
			try {
				response = await client.req.post( {
					path: '/studio-app/ai-assistant/chat',
					apiNamespace: 'wpcom/v2',
					body,
				} );
			} catch ( error ) {
				throw new Error( 'Failed to fetch assistant' );
			} finally {
				setIsLoading( false );
			}
			const message = response?.choices?.[ 0 ]?.message?.content;

			return { message };
		},
		[ client ]
	);

	return { fetchAssistant, isLoading };
}
