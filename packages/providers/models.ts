import { getProviderDescriptor, PROVIDER_IDS } from './descriptors';
import type { ANTHROPIC_AI_MODELS } from './anthropic/descriptor';
import type { CUSTOM_AI_MODELS } from './custom/descriptor';
import type { ProviderId, AiModel } from './types';
import type { WPCOM_AI_MODELS } from './wpcom/descriptor';

export type AiModelId = (
	| typeof WPCOM_AI_MODELS
	| typeof ANTHROPIC_AI_MODELS
	| typeof CUSTOM_AI_MODELS
)[ number ][ 'id' ];

export function getAiModels( provider: ProviderId ): readonly AiModel< AiModelId >[] {
	return getProviderDescriptor( provider ).ai?.models ?? [];
}

export function getAiModel( provider: ProviderId, id: string ): AiModel< AiModelId > | undefined {
	return getAiModels( provider ).find( ( model ) => model.id === id );
}

export function getAiModelProviders( id: string ): ProviderId[] {
	return PROVIDER_IDS.filter( ( provider ) => getAiModel( provider, id ) );
}

export function isAiModelId( value: string ): value is AiModelId {
	return getAiModelProviders( value ).length > 0;
}

export function getAiModelLabel( id: AiModelId ): string {
	const [ provider ] = getAiModelProviders( id );
	return getAiModel( provider, id )?.label() ?? id;
}

// `paidDefaultModel` when the account has paid AI credits left; callers
// without quota data get the plain default.
export function getDefaultAiModel(
	provider: ProviderId,
	options?: { canUsePaidModels?: boolean }
): AiModelId {
	const ai = getProviderDescriptor( provider ).ai;
	if ( ! ai ) {
		throw new Error( `${ provider } offers no AI models` );
	}
	return ( options?.canUsePaidModels && ai.paidDefaultModel ) || ai.defaultModel;
}
