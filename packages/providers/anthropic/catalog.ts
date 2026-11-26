import { ANTHROPIC_MODELS } from '@earendil-works/pi-ai/providers/anthropic.models';
import { fetchModelList, piCatalog, versionOf } from '../catalog';
import { ANTHROPIC_MODELS_URL, anthropicHeaders } from './api';
import { ANTHROPIC_AI_MODELS } from './descriptor';
import type { AnthropicConfig } from './config';

/**
 * Claude models, such as `claude-opus-5-5` or `claude-haiku-4-5-20251001`, the newest of each
 * family recommended. A Claude plan isn't billed by the token, so only an API key's models show
 * their price.
 */
export const anthropicCatalog = piCatalog< AnthropicConfig >( {
	piModels: ANTHROPIC_MODELS,
	parse( id ) {
		const [ , family, major, minor ] =
			/^claude-(sonnet|opus|fable|haiku)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?$/.exec( id ) ?? [];
		return family ? { family, version: versionOf( major, minor ) } : undefined;
	},
	studioModels: ANTHROPIC_AI_MODELS,
	async listAccountModels( config ) {
		const body = await fetchModelList< { data?: { id: string }[] } >(
			`${ ANTHROPIC_MODELS_URL }?limit=1000`,
			anthropicHeaders( config )
		);
		return body?.data?.map( ( { id } ) => ( { id } ) );
	},
	showsPrices: ( config ) => config.method === 'api-key',
	notConnected: 'Connect Anthropic to see its models.',
} );
