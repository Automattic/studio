import {
	AI_PROVIDER_IDS,
	DEFAULT_PROVIDER_ID,
	findAiModel,
	getDefaultAiModel,
	getProvider,
	normalizeProviderId,
	type AiModelId,
	type AiProviderId,
	type ProviderId,
} from '@studio/providers';
import { isStudioCustomEntryOfType } from '@studio/agent/protocol/sessions/entry-types';
import type { SessionEntry } from '@earendil-works/pi-coding-agent';
import type { AiSettings } from '@studio/common/lib/ai-settings';

/**
 * Read the raw model id recorded on a single session entry, if any.
 *
 * Looks at the `model_change` entry the UI writes when the user picks a model
 * and the `studio.session_context` payload the CLI records per turn. Returns
 * the stored string verbatim (no validation) so callers can distinguish "no
 * model recorded" from "a model we no longer offer".
 */
function readEntryModelId( entry: SessionEntry ): string | undefined {
	if ( entry.type === 'model_change' ) {
		const modelId = ( entry as { modelId?: unknown } ).modelId;
		return typeof modelId === 'string' ? modelId : undefined;
	}
	if ( isStudioCustomEntryOfType( entry, 'studio.session_context' ) ) {
		const model = entry.data?.model;
		return typeof model === 'string' ? model : undefined;
	}
	return undefined;
}

/**
 * The most recently recorded model a provider still offers, or `undefined`
 * when the session never recorded one (or only models we no longer offer) —
 * so callers can apply their own default to both cases.
 */
export function readRecordedSessionModel( entries: SessionEntry[] ): AiModelId | undefined {
	for ( let index = entries.length - 1; index >= 0; index -= 1 ) {
		const recordedModel = readEntryModelId( entries[ index ] );
		if ( recordedModel !== undefined && findAiModel( recordedModel ) ) {
			return recordedModel as AiModelId;
		}
	}
	return undefined;
}

/** `readRecordedSessionModel` with a fallback for sessions without one. */
export function resolveSessionModel(
	entries: SessionEntry[],
	defaultModel: AiModelId = getDefaultAiModel( DEFAULT_PROVIDER_ID )
): AiModelId {
	return readRecordedSessionModel( entries ) ?? defaultModel;
}

/**
 * `resolveSessionModel` constrained to what the provider can serve: a
 * recorded model it no longer offers snaps to the provider's default.
 */
export function resolveSessionModelForProvider(
	entries: SessionEntry[],
	provider: ProviderId,
	options?: { canUsePaidModels?: boolean }
): AiModelId {
	const defaultModel = getDefaultAiModel( provider, options );
	const model = resolveSessionModel( entries, defaultModel );
	return getProvider( provider ).ai?.models.some( ( { id } ) => id === model )
		? model
		: defaultModel;
}

/**
 * The provider a session is pinned to: the latest `studio.session_context`
 * entry naming a provider wins. Only explicit switches record one (per-turn
 * records carry just the model), so pins survive fallback runs. Undefined
 * when never pinned — callers fall back to the saved global selection.
 */
export function resolveSessionProvider( entries: SessionEntry[] ): AiProviderId | undefined {
	for ( let index = entries.length - 1; index >= 0; index -= 1 ) {
		const entry = entries[ index ];
		if ( isStudioCustomEntryOfType( entry, 'studio.session_context' ) ) {
			const provider =
				entry.data?.provider && normalizeProviderId( entry.data.provider, AI_PROVIDER_IDS );
			if ( provider ) {
				return provider;
			}
		}
	}
	return undefined;
}

/**
 * The provider a conversation effectively runs on: its pinned choice first,
 * then the saved global selection. A provider that isn't connected can't run
 * it, so the first connected provider does, WordPress.com first; with none
 * (or while settings are loading), WordPress.com.
 */
export function getEffectiveSessionProvider(
	entries: SessionEntry[],
	settings?: AiSettings | null
): AiProviderId {
	const provider = settings && ( resolveSessionProvider( entries ) ?? settings.provider );
	if ( provider && settings.accounts[ provider ].connected ) {
		return provider;
	}
	return (
		AI_PROVIDER_IDS.find( ( id ) => settings?.accounts[ id ].connected ) ?? DEFAULT_PROVIDER_ID
	);
}
