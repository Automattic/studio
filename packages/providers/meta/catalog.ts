import { META_MODELS } from '@earendil-works/pi-ai/providers/meta.models';
import { fetchModelList, piCatalog, versionOf } from '../catalog';
import { MODELS_URL } from './account';
import { META_AI_MODELS } from './descriptor';
import type { MetaConfig } from './config';

/**
 * Muse models, such as `muse-spark-1.3`, or `muse-spark-1.3-contributor`, a family of its own.
 * The newest of Studio's families (Spark, Wonder) are recommended.
 */
export const metaCatalog = piCatalog< MetaConfig >( {
	piModels: META_MODELS,
	parse( id ) {
		const [ , family, major, minor, variant = '' ] =
			/^muse-([a-z]+)-(\d+)\.(\d+)(-contributor)?$/.exec( id ) ?? [];
		return family ? { family: family + variant, version: versionOf( major, minor ) } : undefined;
	},
	studioModels: META_AI_MODELS,
	async listAccountModels( config ) {
		const body = await fetchModelList< { data?: { id: string }[] } >( MODELS_URL, {
			Authorization: `Bearer ${ config.apiKey }`,
		} );
		return body?.data?.map( ( { id } ) => ( { id } ) );
	},
	notConnected: 'Connect Meta to see its models.',
} );
