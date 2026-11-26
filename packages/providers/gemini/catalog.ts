import { GOOGLE_MODELS } from '@earendil-works/pi-ai/providers/google.models';
import { fetchModelList, piCatalog, versionOf } from '../catalog';
import { GEMINI_MODELS_URL } from './account';
import { GEMINI_AI_MODELS } from './descriptor';
import type { GeminiConfig } from './config';

/**
 * Gemini chat models, such as `gemini-3.8-flash`, `gemini-3.1-flash-lite-preview` or
 * `gemini-4-argon`, rather than an alias (`gemini-flash-latest`) or a model made for one task
 * (`…-computer-use-…`). The newest of Studio's families (Flash, Argon) are recommended.
 */
export const geminiCatalog = piCatalog< GeminiConfig >( {
	piModels: GOOGLE_MODELS,
	parse( id ) {
		const [ , major, minor, family ] =
			/^gemini-(\d+)(?:\.(\d+))?-([a-z]+(?:-lite)?)(?:-preview)?$/.exec( id ) ?? [];
		return major ? { family, version: versionOf( major, minor ) } : undefined;
	},
	studioModels: GEMINI_AI_MODELS,
	async listAccountModels( config ) {
		const body = await fetchModelList< { models?: { name: string }[] } >(
			`${ GEMINI_MODELS_URL }?pageSize=1000`,
			{ 'x-goog-api-key': config.apiKey }
		);
		return body?.models?.map( ( { name } ) => ( { id: name.replace( /^models\//, '' ) } ) );
	},
	notConnected: 'Connect Google Gemini to see its models.',
} );
