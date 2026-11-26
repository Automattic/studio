import { XAI_MODELS } from '@earendil-works/pi-ai/providers/xai.models';
import { fetchModelList, piCatalog, versionOf } from '../catalog';
import { XAI_AI_MODELS } from './descriptor';
import type { XaiConfig } from './config';

/**
 * Grok models, such as `grok-4.7`, or `grok-4.1-fast-reasoning`, a family of its own; the newest
 * Grok is recommended. A Grok plan isn't billed by the token, so only an API key's models show
 * their price.
 */
export const xaiCatalog = piCatalog< XaiConfig >( {
	piModels: XAI_MODELS,
	parse( id ) {
		const [ , major, minor, family = '' ] =
			/^grok-(\d+)(?:\.(\d+))?(?:-([a-z]+(?:-[a-z]+)*))?$/.exec( id ) ?? [];
		return major ? { family, version: versionOf( major, minor ) } : undefined;
	},
	studioModels: XAI_AI_MODELS,
	async listAccountModels( config ) {
		const body = await fetchModelList< { data?: { id: string }[] } >(
			'https://api.x.ai/v1/models',
			{ Authorization: `Bearer ${ config.method === 'grok' ? config.accessToken : config.apiKey }` }
		);
		return body?.data?.map( ( { id } ) => ( { id } ) );
	},
	showsPrices: ( config ) => config.method === 'api-key',
	notConnected: 'Connect xAI to see its models.',
} );
