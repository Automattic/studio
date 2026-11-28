import { OPENAI_MODELS } from '@earendil-works/pi-ai/providers/openai.models';
import { fetchModelList, piCatalog, versionOf } from '../catalog';
import { MODELS_URL } from './account';
import { OPENAI_AI_MODELS } from './descriptor';
import type { OpenaiConfig } from './config';

/**
 * GPT models, such as `gpt-6.1-terra`, `gpt-5.3-codex` or `gpt-5`, the newest of Studio's
 * families (Terra, Sol) recommended. A ChatGPT plan's sign-in gets the plan's own list, which says
 * what each model is for and hides some; it isn't billed by the token, so only an API key's models
 * show their price.
 */
export const openaiCatalog = piCatalog< OpenaiConfig >( {
	piModels: OPENAI_MODELS,
	parse( id ) {
		const [ , major, minor, family = '' ] =
			/^gpt-(\d+)(?:\.(\d+))?(?:-([a-z]+(?:-[a-z]+)*))?$/.exec( id ) ?? [];
		return major ? { family, version: versionOf( major, minor ) } : undefined;
	},
	studioModels: OPENAI_AI_MODELS,
	async listAccountModels( config ) {
		const body = await fetchModelList< {
			data?: { id: string }[];
			models?: { slug: string; visibility?: string; description?: string }[];
		} >( MODELS_URL, {
			Authorization: `Bearer ${ config.method === 'api-key' ? config.apiKey : config.accessToken }`,
		} );
		return (
			body?.data?.map( ( { id } ) => ( { id } ) ) ??
			body?.models
				?.filter( ( model ) => model.visibility !== 'hide' )
				.map( ( { slug, description } ) => ( { id: slug, description } ) )
		);
	},
	showsPrices: ( config ) => config.method === 'api-key',
	notConnected: 'Connect OpenAI to see its models.',
} );
