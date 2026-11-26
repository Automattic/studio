import { describe, expect, it } from 'vitest';
import { ImageFilteredError, TransientImageError } from '../../wpcom/ai/images';
import { metaImageDialect } from '../images';

const { body, read } = metaImageDialect;

const gifBase64 = 'R0lGODlhAQABAA==';
const webpBase64 = 'UklGRiQAAABXRUJQ';

describe( 'the Meta image request', () => {
	it( 'asks for a quick WebP on the canvas the slot wants, without searching the web', () => {
		expect( body( { prompt: 'a shop front', aspectRatio: 'portrait' }, 'muse-image-1.0' ) ).toEqual(
			{
				model: 'muse-image-1.0',
				prompt: 'a shop front',
				size: '1024x1536',
				output_format: 'webp',
				reasoning_strength: 'low',
				tool_enablement: {
					enable_image_search: false,
					enable_web_search: false,
					enable_shell: false,
				},
			}
		);
	} );
} );

describe( 'the Meta image response', () => {
	it( 'returns the WebP bytes', () => {
		const raw = JSON.stringify( { data: [ { b64_json: webpBase64 } ], output_format: 'webp' } );
		expect( read( raw, 200 ) ).toEqual(
			Uint8Array.from( atob( webpBase64 ), ( char ) => char.charCodeAt( 0 ) )
		);
	} );

	it( 'retries a busy or failing backend', () => {
		expect( () => read( 'rate limited', 429 ) ).toThrow( TransientImageError );
		expect( () => read( '{"error":{"type":"server_error"}}', 503 ) ).toThrow( TransientImageError );
	} );

	it( 'reports a safety block as filtering, which a rewrite can pass', () => {
		const raw = JSON.stringify( {
			error: { code: 'content_policy_violation', param: 'prompt', message: 'blocked' },
		} );
		expect( () => read( raw, 400 ) ).toThrow( ImageFilteredError );
	} );

	it( 'refuses an image that is neither a WebP, a PNG nor a JPEG', () => {
		const raw = JSON.stringify( { data: [ { b64_json: gifBase64 } ] } );
		expect( () => read( raw, 200 ) ).toThrow( /neither a WebP, a PNG nor a JPEG/ );
	} );
} );
