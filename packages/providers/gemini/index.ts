import { GOOGLE_MODELS } from '@earendil-works/pi-ai/providers/google.models';
import { __ } from '@wordpress/i18n';
import { InvalidCredentialError, ProviderNotReadyError } from '../errors';
import { GEMINI_AI_MODELS, geminiConnectInput, geminiDescriptor } from './descriptor';
import type { GeminiConfig } from './config';
import type { Provider } from '../types';

export const geminiProvider: Provider< GeminiConfig > = {
	descriptor: geminiDescriptor,
	async connect( input ) {
		const parsed = geminiConnectInput().safeParse( input );
		if ( ! parsed.success ) {
			throw new InvalidCredentialError( parsed.error.issues[ 0 ].message );
		}
		const { apiKey } = parsed.data;
		// Listing models costs no tokens. Like Anthropic, allow saving a key while offline.
		const response = await fetch(
			'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1',
			{
				headers: { 'x-goog-api-key': apiKey },
				signal: AbortSignal.timeout( 10_000 ),
			}
		).catch( () => undefined );
		if ( response && [ 400, 401, 403 ].includes( response.status ) ) {
			throw new InvalidCredentialError(
				__( 'Google rejected this API key. Check the key and try again.' )
			);
		}
		return { method: 'api-key', apiKey };
	},
	ai: {
		fallbackWhenNotReady: false,
		async connect( config, modelId ) {
			if ( ! config ) {
				throw new ProviderNotReadyError(
					__( 'Gemini API key required. Use /provider to connect Google Gemini.' )
				);
			}
			const model = GEMINI_AI_MODELS.find( ( entry ) => entry.id === modelId );
			if ( ! model ) {
				throw new Error( `Google Gemini does not serve ${ modelId }` );
			}
			// Carbon shares Argon's Gemini 4 API settings and is newer than the pinned pi catalog.
			const catalogModel =
				GOOGLE_MODELS[ model.id === 'gemini-4-carbon' ? 'gemini-4-argon' : model.id ];
			return {
				piProvider: 'google',
				apiKey: config.apiKey,
				model: { ...catalogModel, id: model.id, name: model.label() },
			};
		},
	},
};
