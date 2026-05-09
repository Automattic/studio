import { describe, expect, it } from 'vitest';
import { getRenderedText } from './html';

describe( 'getRenderedText', () => {
	it( 'extracts text from rendered WordPress HTML', () => {
		expect( getRenderedText( { rendered: '<p>Hello <strong>world</strong></p>' } ) ).toBe(
			'Hello world'
		);
	} );

	it( 'returns an empty string for missing rendered content', () => {
		expect( getRenderedText( null ) ).toBe( '' );
		expect( getRenderedText( { rendered: '' } ) ).toBe( '' );
	} );
} );
