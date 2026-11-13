import { OPENAI_MODELS } from '@earendil-works/pi-ai/providers/openai.models';
import { __ } from '@wordpress/i18n';
import { NotConnectedError } from '../errors';
import { OPENAI_AI_MODELS } from './descriptor';
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
			throw new NotConnectedError( 'Sign in with ChatGPT to use its models.' );
		}
		const model =
			OPENAI_AI_MODELS.some( ( { id } ) => id === modelId ) &&
			OPENAI_MODELS[ modelId as keyof typeof OPENAI_MODELS ];
		if ( ! model ) {
			throw new Error( `ChatGPT does not serve ${ modelId }` );
		}
		return {
			piProvider: 'openai',
			apiKey: config.accessToken,
			rewriteError: ( message ) =>
				Object.entries( getPlanErrors() ).find( ( [ code ] ) => message.includes( code ) )?.[ 1 ],
			model: {
				...model,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 200_000,
				maxTokens: 32_000,
			},
		};
	},
};
