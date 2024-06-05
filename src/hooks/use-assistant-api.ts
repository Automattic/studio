import { useCallback, useState } from 'react';
import { Message } from './use-assistant';
import { useAuth } from './use-auth';

export function useAssistantApi() {
	const { client } = useAuth();
	const [ isLoading, setIsLoading ] = useState( false );

	const fetchAssistant = useCallback(
		async ( chatId: string | null, messages: Message[] ) => {
			if ( ! client ) {
				throw new Error( 'WPcom client not initialized' );
			}
			setIsLoading( true );
			const body = {
				messages,
				chat_id: chatId ?? undefined,
				context: {
					plugins: [ 'jetpack' ],
					wp_version: '5.8.1',
					php_version: '7.4.24',
					number_of_sites: 4,
				},
			};
			let response;
			try {
				response = await client.req.post( {
					path: '/studio-app/ai-assistant/chat',
					apiNamespace: 'wpcom/v2',
					body,
				} );
			} finally {
				setIsLoading( false );
			}
			const message = response?.messages?.[ 0 ]?.content;

			return { message, chatId: response?.chat_id };
		},
		[ client ]
	);

	return { fetchAssistant, isLoading };
}
