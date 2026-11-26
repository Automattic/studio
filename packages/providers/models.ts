import { AI_PROVIDER_IDS, getProvider } from './registry';
import type { GITHUB_COPILOT_MODEL_PREFIXES } from './github-copilot/descriptor';
import type { AccountModel, AiModel, AiProviderId, ProviderId } from './types';
import type { WPCOM_AI_MODELS } from './wpcom/descriptor';

export type AiModelId =
	| ( typeof WPCOM_AI_MODELS )[ number ][ 'id' ]
	// From a provider's catalog, which the models every other provider lists belong to.
	| `${ ( typeof GITHUB_COPILOT_MODEL_PREFIXES )[ number ] }${ string }`
	| `muse-${ string }`
	| `openrouter/${ string }`
	| `local-llm/${ string }`;

// How much a model thinks before answering, from a chat's pick; pi runs a model that lacks the
// level at the nearest one it has.
export const THINKING_LEVELS = [ 'off', 'low', 'medium', 'high' ] as const;
export type ThinkingLevel = ( typeof THINKING_LEVELS )[ number ];

// Whether the model's id is one the provider's catalog names its models with.
function inCatalog( provider: ProviderId, id: string ): boolean {
	const prefixes = getProvider( provider ).ai?.catalog?.prefixes ?? [];
	return prefixes.some( ( prefix ) => id.startsWith( prefix ) );
}

// Whether the provider can run the model: one it lists, or one from its catalog.
export function servesAiModel( provider: ProviderId, id: string ): boolean {
	return (
		Boolean( getProvider( provider ).ai?.models.some( ( model ) => model.id === id ) ) ||
		inCatalog( provider, id )
	);
}

function catalogModel( {
	id,
	label,
	supportsImages,
	thinking,
}: AccountModel ): AiModel< AiModelId > {
	return { id, label: () => label ?? id.slice( id.indexOf( '/' ) + 1 ), supportsImages, thinking };
}

/**
 * The models a surface offers for the provider: the ones the account it is given can run
 * (`AccountDetails.models`), or every model the provider lists when it doesn't narrow them.
 */
export function getAiModels(
	provider: ProviderId,
	account?: { models?: readonly AccountModel[] }
): readonly AiModel< AiModelId >[] {
	const models = getProvider( provider ).ai?.models ?? [];
	return (
		account?.models?.flatMap( ( offered ) => {
			const listed = models.find( ( { id } ) => id === offered.id );
			if ( listed ) {
				return [ listed ];
			}
			return inCatalog( provider, offered.id ) ? [ catalogModel( offered ) ] : [];
		} ) ?? models
	);
}

// A model by its id, and the first provider that serves it.
export function findAiModel(
	id: string
): { provider: AiProviderId; model: AiModel< AiModelId > } | undefined {
	for ( const provider of AI_PROVIDER_IDS ) {
		const model = getProvider( provider ).ai?.models.find( ( candidate ) => candidate.id === id );
		if ( model ) {
			return { provider, model };
		}
	}
	const provider = AI_PROVIDER_IDS.find( ( candidate ) => inCatalog( candidate, id ) );
	return provider && { provider, model: catalogModel( { id: id as AiModelId } ) };
}

// `paidDefaultModel` when the account has paid AI credits left; callers
// without quota data get the plain default. An account that narrows the models
// (`AccountDetails.models`) without the default gets its first one.
export function getDefaultAiModel(
	provider: ProviderId,
	options?: {
		canUsePaidModels?: boolean;
		account?: { connected: boolean; models?: readonly AccountModel[] };
	}
): AiModelId {
	const ai = getProvider( provider ).ai;
	if ( ! ai ) {
		throw new Error( `${ provider } offers no AI models` );
	}
	const model = ( options?.canUsePaidModels && ai.paidDefaultModel ) || ai.defaultModel;
	const offered = options?.account?.models;
	return ! offered?.length || offered.some( ( { id } ) => id === model ) ? model : offered[ 0 ].id;
}
