import { describe, expect, it } from 'vitest';
import { designSheet, themeJsonDesign } from './index';

describe( 'WordPress style boards', () => {
	it( 'uses Site Editor overrides and resolved WordPress colors, fonts and buttons', () => {
		const tokens = themeJsonDesign( {
			settings: {
				color: {
					palette: {
						default: [ { slug: 'white', color: '#ffffff' } ],
						theme: [
							{ slug: 'base', color: '#fefefe' },
							{ slug: 'ink', color: '#111111' },
							{ slug: 'accent', color: '#ff0000' },
						],
						custom: [ { slug: 'accent', color: '#123456' } ],
					},
				},
				spacing: { spacingSizes: { theme: [ { slug: '40', size: '1.5rem' } ] } },
			},
			styles: {
				color: { background: '#ffffff', text: '#111111' },
				typography: { fontFamily: 'Manrope, sans-serif', fontSize: '1rem' },
				elements: {
					h1: { typography: { fontSize: '4rem' } },
					button: {
						color: { background: '#123456' },
						border: { radius: '999px' },
						spacing: { padding: { top: '8px', right: '16px', bottom: '8px', left: '16px' } },
					},
				},
			},
		} );
		expect( designSheet( tokens ) ).toMatchObject( {
			background: '#ffffff',
			text: '#111111',
			primary: '#123456',
			display: { fontFamily: 'Manrope, sans-serif', fontSize: '4rem' },
			body: { fontFamily: 'Manrope, sans-serif', fontSize: '1rem' },
			button: { backgroundColor: '#123456', rounded: '999px', padding: '8px 16px 8px 16px' },
		} );
		expect( tokens.spacing ).toEqual( { 40: '1.5rem' } );
		expect( Object.values( tokens.colors! ) ).not.toContain( '#ff0000' );
	} );

	it( 'keeps saved background and text styles when the palette uses the same slugs', () => {
		const tokens = themeJsonDesign( {
			settings: {
				color: {
					palette: [
						{ slug: 'background', color: '#ffffff' },
						{ slug: 'text', color: '#000000' },
					],
				},
			},
			styles: { color: { background: '#222222', text: '#eeeeee' } },
		} );
		expect( designSheet( tokens ) ).toMatchObject( { background: '#222222', text: '#eeeeee' } );
	} );

	it.each( [ 'rgb(34, 34, 34)', 'hsl(0, 0%, 14%)' ] )(
		'preserves CSS colors such as %s',
		( color ) => {
			const tokens = themeJsonDesign( {
				settings: { color: { palette: [ { slug: 'accent', color } ] } },
				styles: { color: { background: color, text: 'white' } },
			} );
			expect( designSheet( tokens ) ).toMatchObject( {
				background: color,
				text: 'white',
				primary: color,
			} );
		}
	);

	it( 'reads unresolved presets from WordPress 6.2', () => {
		const tokens = themeJsonDesign( {
			settings: {
				color: {
					palette: [
						{ slug: 'base', color: '#ffffff' },
						{ slug: 'ink', color: '#111111' },
					],
				},
				typography: { fontFamilies: [ { slug: 'body', fontFamily: 'Inter' } ] },
			},
			styles: {
				color: { background: 'var:preset|color|base', text: 'var(--wp--preset--color--ink)' },
				typography: { fontFamily: 'var:preset|font-family|body' },
			},
		} );
		expect( designSheet( tokens ) ).toMatchObject( {
			background: '#ffffff',
			text: '#111111',
			body: { fontFamily: 'Inter' },
		} );
	} );

	it( 'uses core presets when the theme has no palette', () => {
		const tokens = themeJsonDesign( {
			settings: {
				color: {
					palette: {
						default: [
							{ slug: 'black', color: '#000000' },
							{ slug: 'white', color: '#ffffff' },
						],
					},
				},
			},
		} );
		expect( designSheet( tokens ) ).toMatchObject( { background: '#ffffff', text: '#000000' } );
	} );

	it( 'also accepts the preset arrays in a theme.json file', () => {
		const tokens = themeJsonDesign( {
			settings: {
				color: {
					palette: [
						{ slug: 'ink', color: '#111111' },
						{ slug: 'base', color: '#ffffff' },
					],
				},
			},
		} );
		expect( tokens.colors ).toMatchObject( { ink: '#111111', base: '#ffffff' } );
	} );
} );
