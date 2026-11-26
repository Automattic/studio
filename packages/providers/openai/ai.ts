import { __ } from '@wordpress/i18n';
import { NotConnectedError } from '../errors';
import { openaiCatalog } from './catalog';
import { generateOpenaiImages } from './images';
import type { OpenaiConfig } from './config';
import type { AiConnection, ProviderServices } from '../types';

// Plan-sharing errors, said for the user.
const getPlanErrors = () => ( {
	subscription_sharing_usage_limit_exceeded: __(
		'You reached your ChatGPT plan’s usage limit. Manage usage at chatgpt.com/settings/usage.'
	),
	subscription_sharing_user_not_eligible: __(
		'Your ChatGPT plan can’t be used in WordPress Studio.'
	),
	subscription_sharing_invalid_user: __(
		'Your ChatGPT sign-in no longer works. Connect ChatGPT again in Settings.'
	),
	subscription_sharing_usage_unavailable: __(
		'ChatGPT plan usage is unavailable right now. Try again shortly.'
	),
} );

export const openaiAi: NonNullable< ProviderServices< OpenaiConfig >[ 'ai' ] > = {
	async model( config, modelId ): Promise< AiConnection > {
		if ( ! config ) {
			throw new NotConnectedError( 'Connect OpenAI with a ChatGPT plan or an API key.' );
		}
		const model = openaiCatalog.run( modelId );
		if ( ! model ) {
			throw new Error( `OpenAI does not serve ${ modelId }` );
		}
		return {
			piProvider: 'openai',
			apiKey: config.method === 'api-key' ? config.apiKey : config.accessToken,
			rewriteError: ( message ) =>
				Object.entries( getPlanErrors() ).find( ( [ code ] ) => message.includes( code ) )?.[ 1 ],
			model,
		};
	},
	listModels: openaiCatalog.listModels,
	selectModels: openaiCatalog.selectModels,
	generateImages: generateOpenaiImages,
};
