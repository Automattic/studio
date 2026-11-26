import { OPENROUTER_MODELS } from '@earendil-works/pi-ai/providers/openrouter.models';
import { __ } from '@wordpress/i18n';
import { NotConnectedError } from '../errors';
import { OPENROUTER_API_URL, OPENROUTER_HEADERS } from './api';
import { listOpenrouterModels, selectOpenrouterModels } from './catalog';
import { OPENROUTER_MODEL_PREFIX } from './descriptor';
import type { OpenrouterConfig, OpenrouterPickedModel } from './config';
import type { AiModelId } from '../models';
import type { AiConnection, ProviderServices } from '../types';
import type { Api, Model } from '@earendil-works/pi-ai';

const CONTEXT_WINDOW = 200_000;
const MAX_TOKENS = 32_000;

// What pi knows of the model, or, for one newer than its catalog, what the user picked it with.
function findModel( slug: string, picked?: OpenrouterPickedModel ): Model< Api > | undefined {
	const known = ( OPENROUTER_MODELS as Partial< Record< string, Model< Api > > > )[ slug ];
	return (
		known ??
		( picked && {
			id: slug,
			name: picked.label,
			api: 'openai-completions',
			provider: 'openrouter',
			baseUrl: OPENROUTER_API_URL,
			reasoning: picked.reasoning,
			input: picked.images ? [ 'text', 'image' ] : [ 'text' ],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: picked.contextWindow,
			maxTokens: picked.maxTokens ?? MAX_TOKENS,
		} )
	);
}

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
		const slug = modelId.startsWith( OPENROUTER_MODEL_PREFIX )
			? modelId.slice( OPENROUTER_MODEL_PREFIX.length )
			: '';
		const model =
			slug && findModel( slug, config.models?.find( ( picked ) => picked.slug === slug ) );
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
				contextWindow: Math.min( model.contextWindow, CONTEXT_WINDOW ),
				maxTokens: Math.min( model.maxTokens, MAX_TOKENS ),
			},
		};
	},
	listModels: listOpenrouterModels,
	selectModels: selectOpenrouterModels,
};
