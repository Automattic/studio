import { OPENROUTER_MODELS } from '@earendil-works/pi-ai/providers/openrouter.models';
import { __ } from '@wordpress/i18n';
import { NotConnectedError } from '../errors';
import { OPENROUTER_HEADERS } from './api';
import { OPENROUTER_AI_MODELS } from './descriptor';
import { generateOpenrouterImages } from './images';
import type { OpenrouterConfig } from './config';
import type { AiModelId } from '../models';
import type { AiConnection, ProviderServices } from '../types';
import type { Api, Model } from '@earendil-works/pi-ai';

// OpenRouter's name for each of Studio's models.
const OPENROUTER_MODEL_SLUGS: Record< ( typeof OPENROUTER_AI_MODELS )[ number ][ 'id' ], string > =
	{
		'claude-sonnet-5-5': 'anthropic/claude-sonnet-5.5',
		'claude-opus-5-5': 'anthropic/claude-opus-5.5',
		'gpt-6.1-terra': 'openai/gpt-6.1-terra',
		'gemini-4-argon': 'google/gemini-4-argon',
		'grok-4.7': 'x-ai/grok-4.7',
		'deepseek-v4.1-flash': 'deepseek/deepseek-v4.1-flash',
		'kimi-k3': 'moonshotai/kimi-k3',
	};

// Errors by HTTP status, said for the user. pi starts a stream error's message
// with the status.
const getErrors = (): Record< number, string > => ( {
	401: __( 'OpenRouter rejected the API key. Connect OpenRouter again in Settings.' ),
	402: __(
		'Your OpenRouter credits ran out, or this key reached its credit limit. Add credits on openrouter.ai.'
	),
	403: __( 'OpenRouter’s moderation refused this request.' ),
	429: __( 'OpenRouter is limiting requests on your key. Try again shortly.' ),
} );

export function rewriteOpenrouterError( message: string ): string | undefined {
	const status = message.match( /^(\d{3})\b/ )?.[ 1 ];
	return status ? getErrors()[ Number( status ) ] : undefined;
}

export const openrouterAi: NonNullable< ProviderServices< OpenrouterConfig >[ 'ai' ] > = {
	async model( config, modelId: AiModelId ): Promise< AiConnection > {
		if ( ! config ) {
			throw new NotConnectedError( 'Connect OpenRouter by signing in or with an API key.' );
		}
		const slug = OPENROUTER_MODEL_SLUGS[ modelId as keyof typeof OPENROUTER_MODEL_SLUGS ];
		const model = slug
			? ( OPENROUTER_MODELS as Partial< Record< string, Model< Api > > > )[ slug ]
			: undefined;
		if ( ! model ) {
			throw new Error( `OpenRouter does not serve ${ modelId }` );
		}
		return {
			piProvider: 'openrouter',
			apiKey: config.apiKey,
			headers: OPENROUTER_HEADERS,
			requestModelId: slug,
			rewriteError: rewriteOpenrouterError,
			model: {
				...model,
				id: modelId,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 200_000,
				maxTokens: 32_000,
			},
		};
	},
	generateImages: generateOpenrouterImages,
};
