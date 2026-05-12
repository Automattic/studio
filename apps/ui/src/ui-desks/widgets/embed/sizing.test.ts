import { describe, expect, it } from 'vitest';
import { getFittedEmbedShapeProps } from './sizing';

describe( 'embed widget sizing', () => {
	it( 'keeps the current width and fits height to the embed definition aspect ratio', () => {
		expect(
			getFittedEmbedShapeProps(
				{ url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' },
				{ w: 360, h: 500 }
			)
		).toEqual( {
			w: 360,
			h: 203,
		} );
	} );

	it( 'ignores unsupported embeds', () => {
		expect(
			getFittedEmbedShapeProps( { url: 'https://example.com/' }, { w: 360, h: 500 } )
		).toBeNull();
	} );
} );
