import { useCallback, useState } from 'react';
import { Message } from './use-assistant';
import { useAuth } from './use-auth';
import { usePromptUsage } from './use-prompt-usage';

export function useAssistantApi( selectedSiteId: string ) {
	const { client } = useAuth();
	const [ isLoading, setIsLoading ] = useState< Record< string, boolean > >( {} );
	const { updatePromptUsage } = usePromptUsage();

	const fetchAssistant = useCallback(
		async ( chatId: string | undefined, messages: Message[] ) => {
			if ( ! client ) {
				throw new Error( 'WPcom client not initialized' );
			}
			setIsLoading( ( prev ) => ( { ...prev, [ selectedSiteId ]: true } ) );
			const body = {
				messages,
				chat_id: chatId,
				context: [],
			};
			let response;
			let headers;
			try {
				const { data, response_headers } = await new Promise< {
					data: { choices: { message: { content: string } }[]; id: string };
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
							data: { choices: { message: { content: string } }[]; id: string },
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
				setIsLoading( ( prev ) => ( { ...prev, [ selectedSiteId ]: false } ) );
			}
			const message = response?.choices?.[ 0 ]?.message?.content;
			updatePromptUsage( {
				maxQuota: headers[ 'x-quota-max' ] || '',
				remainingQuota: headers[ 'x-quota-remaining' ] || '',
			} );
			return { message, chatId: response?.id };
		},
		[ client, selectedSiteId, updatePromptUsage ]
	);

	return { fetchAssistant, isLoading: isLoading[ selectedSiteId ] };
}
