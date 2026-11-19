import { AI_PROVIDER_IDS, getProvider } from './registry';
import type { ANTHROPIC_AI_MODELS } from './anthropic/descriptor';
import type { GEMINI_AI_MODELS } from './gemini/descriptor';
import type { GITHUB_COPILOT_AI_MODELS } from './github-copilot/descriptor';
import type { META_AI_MODELS } from './meta/descriptor';
import type { OPENAI_AI_MODELS } from './openai/descriptor';
import type { OPENROUTER_AI_MODELS } from './openrouter/descriptor';
import type { AccountModel, AiModel, AiProviderId, ProviderId } from './types';
import type { WPCOM_AI_MODELS } from './wpcom/descriptor';
import type { XAI_AI_MODELS } from './xai/descriptor';

export type AiModelId =
	| (
			| typeof WPCOM_AI_MODELS
			| typeof ANTHROPIC_AI_MODELS
			| typeof OPENAI_AI_MODELS
			| typeof GEMINI_AI_MODELS
			| typeof GITHUB_COPILOT_AI_MODELS
			| typeof META_AI_MODELS
			| typeof XAI_AI_MODELS
			| typeof OPENROUTER_AI_MODELS
	  )[ number ][ 'id' ]
	// From a provider's catalog.
	| `openrouter/${ string }`;

// The catalog model's provider, which names it with its own id and a slash.
function catalogProvider( id: string ): AiProviderId | undefined {
	return AI_PROVIDER_IDS.find(
		( provider ) => getProvider( provider ).ai?.catalog && id.startsWith( `${ provider }/` )
	);
}

// Whether the provider can run the model: one it lists, or one from its catalog.
export function servesAiModel( provider: ProviderId, id: string ): boolean {
	return (
		Boolean( getProvider( provider ).ai?.models.some( ( model ) => model.id === id ) ) ||
		catalogProvider( id ) === provider
	);
}

function catalogModel( { id, label, supportsImages }: AccountModel ): AiModel< AiModelId > {
	return { id, label: () => label ?? id.slice( id.indexOf( '/' ) + 1 ), supportsImages };
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
			return catalogProvider( offered.id ) === provider ? [ catalogModel( offered ) ] : [];
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
	const provider = catalogProvider( id );
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
