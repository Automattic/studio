import { GITHUB_COPILOT_MODELS } from '@earendil-works/pi-ai/providers/github-copilot.models';
import { __ } from '@wordpress/i18n';
import { NotConnectedError } from '../errors';
import { AI_APIS, type AiApi, type AiConnection, type ServicesOf } from '../types';
import { COPILOT_HEADERS, copilotApiUrl } from './api';
import { GITHUB_COPILOT_AI_MODELS, type githubCopilotProvider } from './descriptor';
import type { Api, Model } from '@earendil-works/pi-ai';

// Copilot names Claude models with dots where Studio's ids, shared with Anthropic, use dashes.
export function toCopilotModelId( id: string ): string {
	return id.startsWith( 'claude-' ) ? id.replace( /(\d)-(\d)/g, '$1.$2' ) : id;
}

// pi's catalog types Copilot's models over every API pi knows, of which Studio runs `AI_APIS`.
function runsInStudio( model: Model< Api > ): model is Model< AiApi > {
	return ( AI_APIS as readonly string[] ).includes( model.api );
}

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

export const githubCopilotAi: ServicesOf< typeof githubCopilotProvider >[ 'ai' ] = {
	async model( config, modelId ): Promise< AiConnection > {
		if ( ! config ) {
			throw new NotConnectedError( 'Sign in with GitHub to use your Copilot plan.' );
		}
		const requestModelId = toCopilotModelId( modelId );
		const model = GITHUB_COPILOT_AI_MODELS.some( ( { id } ) => id === modelId )
			? ( GITHUB_COPILOT_MODELS as Partial< Record< string, Model< Api > > > )[ requestModelId ]
			: undefined;
		if ( ! model ) {
			throw new Error( `GitHub Copilot does not serve ${ modelId }` );
		}
		if ( ! runsInStudio( model ) ) {
			throw new Error(
				`GitHub Copilot serves ${ modelId } over ${ model.api }, which Studio doesn’t run`
			);
		}
		return {
			piProvider: 'github-copilot',
			apiKey: config.copilotToken,
			headers: COPILOT_HEADERS,
			requestModelId: requestModelId === modelId ? undefined : requestModelId,
			rewriteError: rewritePlanError,
			model: {
				...model,
				id: modelId,
				baseUrl: copilotApiUrl( config.copilotToken ),
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 200_000,
				maxTokens: 32_000,
			},
		};
	},
};
