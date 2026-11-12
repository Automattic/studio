import { OPENAI_CODEX_MODELS } from '@earendil-works/pi-ai/providers/openai-codex.models';
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
			getAiModel( 'openai', modelId ) &&
			OPENAI_CODEX_MODELS[ modelId as keyof typeof OPENAI_CODEX_MODELS ];
		if ( ! model ) {
			throw new Error( `ChatGPT does not serve ${ modelId }` );
		}
		// pi reads the ChatGPT account from the access token.
		return {
			piProvider: 'openai-codex',
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
