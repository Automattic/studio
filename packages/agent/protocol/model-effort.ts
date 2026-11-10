import { AI_EFFORT_LEVELS, type AiEffort } from '@studio/common/lib/user-settings/model-favorites';
import { __ } from '@wordpress/i18n';
import { isAiModelId, type AiModelId } from './models';
import { isStudioCustomEntryOfType } from './sessions/entry-types';
import type { SessionEntry } from '@earendil-works/pi-coding-agent';

export type { AiEffort } from '@studio/common/lib/user-settings/model-favorites';

export function isAiEffort( value: unknown ): value is AiEffort {
	return typeof value === 'string' && ( AI_EFFORT_LEVELS as readonly string[] ).includes( value );
}

export function getModelEffortLevels( model: AiModelId ): AiEffort[] {
	return [ 'balanced', 'claude-sonnet-5', 'claude-opus-5' ].includes( model )
		? [ 'low', 'medium', 'high' ]
		: [];
}

export function normalizeModelEffort( model: AiModelId, effort: unknown ): AiEffort {
	return isAiEffort( effort ) && getModelEffortLevels( model ).includes( effort )
		? effort
		: 'default';
}

export function resolveModelEffort(
	model: AiModelId,
	effort: unknown
): Exclude< AiEffort, 'default' > {
	const normalized = normalizeModelEffort( model, effort );
	return normalized === 'default' ? 'medium' : normalized;
}

export function validateTurnModelSettings( settings: { model?: unknown; effort?: unknown } ): {
	model?: AiModelId;
	effort?: AiEffort;
} {
	const { model, effort } = settings;
	if ( model !== undefined && ( typeof model !== 'string' || ! isAiModelId( model ) ) )
		throw new Error( 'Unknown AI model.' );
	if (
		effort !== undefined &&
		( ! isAiEffort( effort ) || ( model && normalizeModelEffort( model, effort ) !== effort ) )
	)
		throw new Error( 'Unsupported effort for this model.' );
	return { model, effort };
}

export function getEffortLabel( effort: AiEffort ): string {
	switch ( effort ) {
		case 'low':
			return __( 'Low' );
		case 'medium':
			return __( 'Medium' );
		case 'high':
			return __( 'High' );
		case 'xhigh':
			return __( 'Extra high' );
		case 'max':
			return __( 'Max' );
		default:
			return __( 'Default' );
	}
}

export function readSessionEffort( entries: SessionEntry[] = [], model: AiModelId ): AiEffort {
	for ( let index = entries.length - 1; index >= 0; index-- ) {
		const entry = entries[ index ];
		// Legacy picker entries use an empty provider; pi also records runtime model metadata.
		if ( entry.type === 'model_change' && entry.provider === '' ) return 'default';
		if ( isStudioCustomEntryOfType( entry, 'studio.session_context' ) && entry.data?.model )
			return entry.data.model === model
				? normalizeModelEffort( model, entry.data.effort )
				: 'default';
	}
	return 'default';
}
