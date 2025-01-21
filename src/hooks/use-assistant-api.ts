import { useSelector, useDispatch } from 'react-redux';
import { RootState } from 'src/stores';
import { selectContextForApi, setIsLoading, selectIsLoading } from 'src/stores/chat-slice';
import { Message } from './use-assistant';
import { useAuth } from './use-auth';
import { usePromptUsage } from './use-prompt-usage';

export function useAssistantApi( selectedSiteId: string ) {
	const { client } = useAuth();
	const dispatch = useDispatch();
	const { updatePromptUsage } = usePromptUsage();
	const context = useSelector( selectContextForApi );
	const isLoading = useSelector( ( state: RootState ) => selectIsLoading( state, selectedSiteId ) );

	const fetchAssistant = async ( chatId: string | undefined, messages: Message[] ) => {
		if ( ! client ) {
			throw new Error( 'WPcom client not initialized' );
		}
		dispatch( setIsLoading( { siteId: selectedSiteId, isLoading: true } ) );
		const body = {
			messages,
			chat_id: chatId,
			context,
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
			dispatch( setIsLoading( { siteId: selectedSiteId, isLoading: false } ) );
		}

		const message = response?.choices?.[ 0 ]?.message?.content;
		const messageApiId = response?.choices?.[ 0 ]?.message?.id;

		updatePromptUsage( {
			maxQuota: headers[ 'x-quota-max' ] || '',
			remainingQuota: headers[ 'x-quota-remaining' ] || '',
		} );

		return { message, messageApiId, chatId: response?.id };
	};

	return { fetchAssistant, isLoading };
}
