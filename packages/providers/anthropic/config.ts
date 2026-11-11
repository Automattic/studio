import { z } from 'zod';

export const anthropicConfigSchema = z.object( {
	method: z.literal( 'api-key' ),
	apiKey: z.string().min( 1 ),
} );

export type AnthropicConfig = z.infer< typeof anthropicConfigSchema >;

const KEY_PREFIX_LENGTH = 16;
const KEY_SUFFIX_LENGTH = 4;

// Enough to recognise the key, never enough to use it; a short key shows
// only its tail so most of it is not echoed back.
export function previewApiKey( key: string ): string {
	if ( key.length <= KEY_PREFIX_LENGTH + KEY_SUFFIX_LENGTH ) {
		return `...${ key.slice( -KEY_SUFFIX_LENGTH ) }`;
	}
	return `${ key.slice( 0, KEY_PREFIX_LENGTH ) }...${ key.slice( -KEY_SUFFIX_LENGTH ) }`;
}
