import { useCallback, useState } from 'react';
import { Message } from './use-assistant';
import { useAuth } from './use-auth';
import { ChatContextType } from './use-chat-context';
import { usePromptUsage } from './use-prompt-usage';

const contextMapper = ( context?: ChatContextType ) => {
	if ( ! context ) {
		return {};
	}
	return {
		current_url: context.currentURL,
		number_of_sites: context.numberOfSites,
		wp_version: context.wpVersion,
		php_version: context.phpVersion,
		plugins: context.pluginList,
		themes: context.themeList,
		current_theme: context.themeName,
		is_block_theme: context.isBlockTheme,
		ide: context.availableEditors,
		site_name: context.siteName,
		os: context.os,
	};
};

export function useAssistantApi( selectedSiteId: string ) {
	const { client } = useAuth();
	const [ isLoading, setIsLoading ] = useState< Record< string, boolean > >( {
		[ selectedSiteId ]: false,
	} );
	const { updatePromptUsage } = usePromptUsage();

	const fetchAssistant = useCallback(
		async ( chatId: string | undefined, messages: Message[], context?: ChatContextType ) => {
			if ( ! client ) {
				throw new Error( 'WPcom client not initialized' );
			}
			setIsLoading( ( prev ) => ( { ...prev, [ selectedSiteId ]: true } ) );
			const body = {
				messages,
				chat_id: chatId,
				context: contextMapper( context ),
			};
			let response;
			let headers;
			try {
				const { data, response_headers } = await new Promise< {
					data: { choices: { message: { content: string; id: number } }[]; id: string };
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
							data: { choices: { message: { content: string; id: number } }[]; id: string },
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
			const messageApiId = response?.choices?.[ 0 ]?.message?.id;
			console.log( messageApiId );

			updatePromptUsage( {
				maxQuota: headers[ 'x-quota-max' ] || '',
				remainingQuota: headers[ 'x-quota-remaining' ] || '',
			} );

			return { message, messageApiId, chatId: response?.id };
		},
		[ client, selectedSiteId, updatePromptUsage ]
	);

	return { fetchAssistant, isLoading: isLoading[ selectedSiteId ] };
}
