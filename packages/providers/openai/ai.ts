import { OPENAI_MODELS } from '@earendil-works/pi-ai/providers/openai.models';
import { ProviderNotReadyError } from '../errors';
import { getAiModel } from '../models';
import type { OpenaiConfig } from './config';
import type { AiConnection, Provider } from '../types';

export const openaiAi: NonNullable< Provider< OpenaiConfig >[ 'ai' ] > = {
	fallbackWhenNotReady: false,
	async connect( config, modelId ): Promise< AiConnection > {
		if ( ! config ) {
			throw new ProviderNotReadyError(
				'ChatGPT sign-in required. Switch to ChatGPT with /provider to sign in.'
			);
		}
		const model =
			getAiModel( 'openai', modelId ) && OPENAI_MODELS[ modelId as keyof typeof OPENAI_MODELS ];
		if ( ! model ) {
			throw new Error( `ChatGPT does not serve ${ modelId }` );
		}
		return {
			piProvider: 'openai',
			apiKey: config.accessToken,
			model: {
				...model,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 200_000,
				maxTokens: 32_000,
			},
		};
	},
};
