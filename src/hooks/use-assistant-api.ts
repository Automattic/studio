import { useCallback, useState } from 'react';
import { Message } from './use-assistant';
import { useAuth } from './use-auth';
import { usePromptUsage } from './use-prompt-usage';

export function useAssistantApi() {
	const { client } = useAuth();
	const [ isLoading, setIsLoading ] = useState( false );
	const { updatePromptUsage } = usePromptUsage();

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
			let headers;
			try {
				const { data, response_headers } = await new Promise< {
					data: { choices: { message: { content: string } }[] };
					response_headers: Record< string, string >;
				} >( ( resolve, reject ) => {
					client.req.post(
						{
							path: '/studio-app/ai-assistant/chat',
							apiNamespace: 'wpcom/v2',
							body,
						},
						(
							error: Error,
							data: { choices: { message: { content: string } }[] },
							headers: Record< string, string >
						) => {
							if ( error ) {
								return reject( error );
							}
							return resolve( { data, response_headers: headers } );
						}
					);
				} );
				response = data;
				headers = response_headers;
			} finally {
				setIsLoading( false );
			}
			const message = response?.choices?.[ 0 ]?.message?.content;
			updatePromptUsage( {
				maxQuota: headers[ 'x-quota-max' ] || '',
				remainingQuota: headers[ 'x-quota-remaining' ] || '',
			} );
			return { message };
		},
		[ client, updatePromptUsage ]
	);

	return { fetchAssistant, isLoading };
}
