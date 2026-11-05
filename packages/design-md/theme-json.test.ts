import { describe, expect, it } from 'vitest';
import { designSheet, themeJsonDesign } from './index';

describe( 'WordPress style boards', () => {
	it( 'uses Site Editor overrides and resolves preset references in colors, fonts and buttons', () => {
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
				typography: {
					fontFamilies: { theme: [ { slug: 'body', fontFamily: 'Manrope, sans-serif' } ] },
					fontSizes: { theme: [ { slug: 'large', size: '4rem' } ] },
				},
				spacing: { spacingSizes: { theme: [ { slug: '40', size: '1.5rem' } ] } },
			},
			styles: {
				color: { background: 'var:preset|color|white', text: 'var:preset|color|ink' },
				typography: { fontFamily: 'var(--wp--preset--font-family--body)', fontSize: '1rem' },
				elements: {
					h1: { typography: { fontSize: 'var:preset|font-size|large' } },
					button: {
						color: { background: 'var(--wp--preset--color--accent)' },
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
