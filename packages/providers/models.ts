import { AI_PROVIDER_IDS, getProvider } from './registry';
import type { ANTHROPIC_AI_MODELS } from './anthropic/descriptor';
import type { GEMINI_AI_MODELS } from './gemini/descriptor';
import type { GITHUB_COPILOT_AI_MODELS } from './github-copilot/descriptor';
import type { OPENAI_AI_MODELS } from './openai/descriptor';
import type { AiModel, AiProviderId, ProviderId } from './types';
import type { WPCOM_AI_MODELS } from './wpcom/descriptor';

// The providers whose models are the ones a server the user runs lists (`ai.userServer`).
type UserServerAiProviderId = 'local-llm';

// A model Studio knows, or a model a server the user runs lists: that provider's id, a slash, and
// the server's name for the model, verbatim.
export type AiModelId =
	| (
			| typeof WPCOM_AI_MODELS
			| typeof ANTHROPIC_AI_MODELS
			| typeof OPENAI_AI_MODELS
			| typeof GEMINI_AI_MODELS
			| typeof GITHUB_COPILOT_AI_MODELS
	  )[ number ][ 'id' ]
	| `${ UserServerAiProviderId }/${ string }`;

// Studio's id for a model the provider's server lists under `name`.
export function toUserServerModelId( provider: UserServerAiProviderId, name: string ): AiModelId {
	return `${ provider }/${ name }`;
}

// The provider whose server lists the model, and the server's name for it, for an id
// `toUserServerModelId` made.
function parseUserServerModelId(
	id: string
): { provider: AiProviderId; name: string } | undefined {
	const separator = id.indexOf( '/' );
	const provider = AI_PROVIDER_IDS.find( ( candidate ) => candidate === id.slice( 0, separator ) );
	const name = id.slice( separator + 1 );
	return provider && getProvider( provider ).ai?.userServer && name
		? { provider, name }
		: undefined;
}

/**
 * The models a surface offers for the provider: the ones the account it is given can run
 * (`AccountDetails.models`), or every model the provider lists when it doesn't narrow them. None
 * for a provider whose models a server the user runs lists, which surfaces read from the server.
 */
export function getAiModels(
	provider: ProviderId,
	account?: { models?: readonly AiModelId[] }
): readonly AiModel< AiModelId >[] {
	const models = getProvider( provider ).ai?.models ?? [];
	const offered = account?.models;
	return offered ? models.filter( ( { id } ) => offered.includes( id ) ) : models;
}

/**
 * A model by its id, and the first provider that serves it. A model a server the user runs lists
 * is labelled with the server's name for it, without reaching the server, so whether it reads
 * images is left unsaid.
 */
export function findAiModel(
	id: string
): { provider: AiProviderId; model: AiModel< AiModelId > } | undefined {
	for ( const provider of AI_PROVIDER_IDS ) {
		const model = getProvider( provider ).ai?.models?.find( ( candidate ) => candidate.id === id );
		if ( model ) {
			return { provider, model };
		}
	}
	const listed = parseUserServerModelId( id );
	return (
		listed && {
			provider: listed.provider,
			model: { id: id as AiModelId, label: () => listed.name },
		}
	);
}

/**
 * Whether the provider serves the model: one it lists, or for a provider whose models a server
 * the user runs lists, any model named for it, whether or not the server still has it.
 */
export function servesAiModel( provider: ProviderId, id: string ): boolean {
	const ai = getProvider( provider ).ai;
	return ai?.userServer
		? parseUserServerModelId( id )?.provider === provider
		: ai?.models?.some( ( model ) => model.id === id ) ?? false;
}

/**
 * The model new chats on the provider start on. `paidDefaultModel` when the account has paid AI
 * credits left; callers without quota data get the plain default. A provider whose models a
 * server the user runs lists starts on the model its account proposed when it connected; until it
 * is connected it has none, and WordPress.com's default, which it doesn't serve, stands in.
 */
export function getDefaultAiModel(
	provider: ProviderId,
	options?: {
		canUsePaidModels?: boolean;
		account?: { model?: AiModelId };
	}
): AiModelId {
	const ai = getProvider( provider ).ai;
	if ( ! ai ) {
		throw new Error( `${ provider } offers no AI models` );
	}
	if ( ai.userServer ) {
		return options?.account?.model ?? getDefaultAiModel( 'wpcom' );
	}
	return ( options?.canUsePaidModels && ai.paidDefaultModel ) || ai.defaultModel;
}
