import { AI_PROVIDER_IDS, getProvider } from './registry';
import type { ANTHROPIC_AI_MODELS } from './anthropic/descriptor';
import type { GEMINI_AI_MODELS } from './gemini/descriptor';
import type { META_AI_MODELS } from './meta/descriptor';
import type { OPENAI_AI_MODELS } from './openai/descriptor';
import type { AiModel, AiProviderId, ProviderId } from './types';
import type { WPCOM_AI_MODELS } from './wpcom/descriptor';

export type AiModelId = (
	| typeof WPCOM_AI_MODELS
	| typeof ANTHROPIC_AI_MODELS
	| typeof OPENAI_AI_MODELS
	| typeof GEMINI_AI_MODELS
	| typeof META_AI_MODELS
)[ number ][ 'id' ];

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
	return undefined;
}

// `paidDefaultModel` when the account has paid AI credits left; callers
// without quota data get the plain default.
export function getDefaultAiModel(
	provider: ProviderId,
	options?: { canUsePaidModels?: boolean }
): AiModelId {
	const ai = getProvider( provider ).ai;
	if ( ! ai ) {
		throw new Error( `${ provider } offers no AI models` );
	}
	return ( options?.canUsePaidModels && ai.paidDefaultModel ) || ai.defaultModel;
}
