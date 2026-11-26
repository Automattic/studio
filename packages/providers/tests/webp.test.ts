import { describe, expect, it } from 'vitest';
import { imageFormat, toWebp } from '../webp';

const fromBase64 = ( base64: string ) =>
	Uint8Array.from( atob( base64 ), ( char ) => char.charCodeAt( 0 ) );

// Tiny images of one color.
const png = fromBase64(
	'iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAIAAAAmkwkpAAAACXBIWXMAAA7EAAAOxAGVKw4bAAAAFElEQVQI12M8EaDBAANMDEgANwcAQCQBSKHfLOEAAAAASUVORK5CYII='
);
const jpeg = fromBase64(
	'/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDABALDA4MChAODQ4SERATGCgaGBYWGDEjJR0oOjM9PDkzODdASFxOQERXRTc4UG1RV19iZ2hnPk1xeXBkeFxlZ2P/2wBDARESEhgVGC8aGi9jQjhCY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2P/wAARCAACAAIDASEAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAT/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAAAAAABf/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AJgYef/Z'
);

describe( 'toWebp', () => {
	it.each( [
		[ 'PNG', png ],
		[ 'JPEG', jpeg ],
	] )( 'encodes a %s as a WebP', async ( _format, bytes ) => {
		expect( imageFormat( await toWebp( bytes ) ) ).toBe( 'webp' );
	} );

	it( 'keeps a WebP as it is', async () => {
		const webp = await toWebp( png );
		expect( await toWebp( webp ) ).toBe( webp );
	} );

	it( 'refuses other formats', async () => {
		await expect( toWebp( new TextEncoder().encode( 'GIF89a' ) ) ).rejects.toThrow(
			/neither a WebP, a PNG nor a JPEG/
		);
	} );
} );
