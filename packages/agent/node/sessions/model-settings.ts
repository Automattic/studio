import {
	isAiEffort,
	normalizeModelEffort,
	type AiEffort,
} from '@studio/agent/protocol/model-effort';
import { isAiModelId } from '@studio/agent/protocol/models';
import {
	isAiProviderId,
	providerServesModel,
	type AiProviderId,
} from '@studio/agent/protocol/providers';
import { appendModelChangeEntry, appendStudioEntry } from './store';

export async function setSessionModelSettings(
	root: string,
	sessionId: string,
	model: string,
	effort?: AiEffort,
	provider?: AiProviderId
): Promise< void > {
	if ( ! isAiModelId( model ) ) throw new Error( `Unknown AI model: ${ model }` );
	if ( provider && ( ! isAiProviderId( provider ) || ! providerServesModel( provider, model ) ) )
		throw new Error( `Model ${ model } is not served by ${ provider }` );
	if (
		effort !== undefined &&
		( ! isAiEffort( effort ) || normalizeModelEffort( model, effort ) !== effort )
	)
		throw new Error( `Unsupported effort for ${ model }` );
	if ( effort === undefined && ! provider ) {
		await appendModelChangeEntry( root, sessionId, '', model );
		return;
	}
	await appendStudioEntry( root, sessionId, 'studio.session_context', { model, effort, provider } );
}
