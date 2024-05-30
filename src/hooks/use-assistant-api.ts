import { useCallback } from 'react';
import { Message } from './use-assistant';
import { useAuth } from './use-auth';

export function useAssistantApi() {
	const { client } = useAuth();

	const fetchAssistant = useCallback(
		async ( messages: Message[] ) => {
			if ( ! client ) {
				throw new Error( 'WPcom client not initialized' );
			}
			const body = {
				messages,
			};
			const response = await client.req.post( {
				path: '/studio-app/ai-assistant/chat',
				apiNamespace: 'wpcom/v2',
				body,
			} );
			const message = response?.choices?.[ 0 ]?.message?.content;

			return { message };
		},
		[ client ]
	);

	return { fetchAssistant };
}
