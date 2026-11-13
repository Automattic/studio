import { GITHUB_COPILOT_MODELS } from '@earendil-works/pi-ai/providers/github-copilot.models';
import { __ } from '@wordpress/i18n';
import { NotConnectedError } from '../errors';
import { COPILOT_HEADERS, copilotApiUrl } from './api';
import { GITHUB_COPILOT_AI_MODELS } from './descriptor';
import type { GithubCopilotConfig } from './config';
import type { AiConnection, ProviderServices } from '../types';
import type { Api, Model } from '@earendil-works/pi-ai';

// Copilot names Claude models with dots where Studio's ids, shared with Anthropic, use dashes.
export function toCopilotModelId( id: string ): string {
	return id.startsWith( 'claude-' ) ? id.replace( /(\d)-(\d)/g, '$1.$2' ) : id;
}

const getPlanErrors = () => [
	{
		pattern: /model_not_supported|requested model is not supported/i,
		message: __(
			'Your Copilot plan doesn’t include this model. Pick another one, or turn it on at github.com/settings/copilot.'
		),
	},
	{
		pattern: /quota|premium request/i,
		message: __(
			'You reached your Copilot plan’s usage limit. Manage usage at github.com/settings/copilot.'
		),
	},
];

export const githubCopilotAi: NonNullable< ProviderServices< GithubCopilotConfig >[ 'ai' ] > = {
	async model( config, modelId ): Promise< AiConnection > {
		if ( ! config ) {
			throw new NotConnectedError( 'Sign in with GitHub to use your Copilot plan.' );
		}
		const requestModelId = toCopilotModelId( modelId );
		const model =
			GITHUB_COPILOT_AI_MODELS.some( ( { id } ) => id === modelId ) &&
			( GITHUB_COPILOT_MODELS as Partial< Record< string, Model< Api > > > )[ requestModelId ];
		if ( ! model ) {
			throw new Error( `GitHub Copilot does not serve ${ modelId }` );
		}
		return {
			piProvider: 'github-copilot',
			apiKey: config.copilotToken,
			headers: COPILOT_HEADERS,
			requestModelId: requestModelId === modelId ? undefined : requestModelId,
			rewriteError: ( message ) =>
				getPlanErrors().find( ( { pattern } ) => pattern.test( message ) )?.message,
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
