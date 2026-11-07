import { describe, expect, it } from 'vitest';
import { renderDesignBoard } from '../design-board';

describe( 'renderDesignBoard', () => {
	it( 'draws a theme whose styles name no font family with the first one it declares', () => {
		// As the climbing-gym eval case wrote it: its fonts outside "typography".
		const board = renderDesignBoard(
			JSON.stringify( {
				version: 3,
				settings: {
					color: {
						palette: [
							{ slug: 'base', color: '#0b0b0d' },
							{ slug: 'accent', color: '#d4ff3a' },
						],
					},
					typography: {
						fontFamilies: [
							{ slug: 'display', fontFamily: "'Archivo Black', sans-serif" },
							{ slug: 'body', fontFamily: "'Space Grotesk', sans-serif" },
						],
					},
				},
				styles: { elements: { heading: { fontFamily: 'var:preset|font-family|display' } } },
			} )
		);
		expect( board ).toContain( 'font-family:"Archivo Black"' );
	} );
} );
