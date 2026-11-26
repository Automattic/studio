import { __ } from '@wordpress/i18n';
import { withinStudioLimits } from '../catalog';
import { NotConnectedError } from '../errors';
import { COPILOT_HEADERS, copilotApiUrl } from './api';
import { findPiModel, listCopilotModels, selectCopilotModels, toCopilotModelId } from './catalog';
import type { GithubCopilotConfig } from './config';
import type { AiConnection, ProviderServices } from '../types';

// Copilot's refusals carry their reason in the message text, said for the user.
function rewritePlanError( message: string ): string | undefined {
	if ( /model_not_supported|requested model is not supported/i.test( message ) ) {
		return __(
			'Your Copilot plan doesn’t include this model. Pick another one, or turn it on at github.com/settings/copilot.'
		);
	}
	if ( /quota|premium request/i.test( message ) ) {
		return __(
			'You reached your Copilot plan’s usage limit. Manage usage at github.com/settings/copilot.'
		);
	}
	return undefined;
}

export const githubCopilotAi: NonNullable< ProviderServices< GithubCopilotConfig >[ 'ai' ] > = {
	async model( config, modelId ): Promise< AiConnection > {
		if ( ! config ) {
			throw new NotConnectedError( 'Sign in with GitHub to use your Copilot plan.' );
		}
		const requestModelId = toCopilotModelId( modelId );
		const model = findPiModel( modelId );
		if ( ! model ) {
			throw new Error( `GitHub Copilot does not serve ${ modelId }` );
		}
		return {
			piProvider: 'github-copilot',
			apiKey: config.copilotToken,
			headers: COPILOT_HEADERS,
			requestModelId: requestModelId === modelId ? undefined : requestModelId,
			rewriteError: rewritePlanError,
			model: withinStudioLimits( {
				...model,
				id: modelId,
				baseUrl: copilotApiUrl( config.copilotToken ),
			} ),
		};
	},
	listModels: listCopilotModels,
	selectModels: selectCopilotModels,
};
