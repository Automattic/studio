import { readFileSync } from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { designSheet, googleFontsUrl, presetList, themeJsonDesign } from './design-sheet';

// A real WordPress install whose default theme to read, when one is given.
const WORDPRESS = process.env.STUDIO_TEST_WORDPRESS;

describe( 'presetList', () => {
	const theme = [ { slug: 'base', color: '#fff' } ];
	it.each( [
		[ 'a theme file list', theme, theme ],
		[ 'nothing', undefined, [] ],
		[ 'resolved theme presets', { default: [ { slug: 'black' } ], theme }, theme ],
		[
			"the user's preset over the theme's",
			{ theme, custom: [ { slug: 'base', color: '#000' } ] },
			[ { slug: 'base', color: '#000' } ],
		],
		[ "core's when the theme has none", { default: [ { slug: 'black' } ] }, [ { slug: 'black' } ] ],
	] )( '%s', ( _, value, expected ) => {
		expect( presetList( value ) ).toEqual( expected );
	} );
} );

describe( 'themeJsonDesign', () => {
	it( 'reads the button, spacing and heading styles theme.json sets', () => {
		const tokens = themeJsonDesign( {
			settings: {
				color: {
					palette: [
						{ slug: 'ink', color: '#111111' },
						{ slug: 'red', color: '#E2231A' },
					],
				},
				spacing: { spacingSizes: [ { slug: '40', size: '1.5rem' } ] },
			},
			styles: {
				color: { background: '#ffffff', text: 'var:preset|color|ink' },
				typography: { fontFamily: 'Nunito, sans-serif', fontSize: '1rem' },
				elements: {
					h1: { typography: { fontSize: '4rem' } },
					button: {
						color: { background: 'var(--wp--preset--color--red)' },
						border: { radius: '999px' },
						spacing: { padding: { top: '8px', right: '16px', bottom: '8px', left: '16px' } },
					},
				},
			},
		} );
		const sheet = designSheet( tokens );

		expect( sheet ).toMatchObject( {
			background: '#ffffff',
			text: '#111111',
			primary: '#E2231A',
			display: { fontFamily: 'Nunito, sans-serif', fontSize: '4rem' },
			button: { backgroundColor: '#E2231A', rounded: '999px', padding: '8px 16px 8px 16px' },
		} );
		expect( tokens.spacing ).toEqual( { 40: '1.5rem' } );
		expect(
			googleFontsUrl(
				sheet.styles.map( ( [ , style ] ) => style ),
				'block'
			)
		).toMatch( /family=Nunito.*&display=block$/ );
	} );

	it( 'needs two colors and a type style to show a sheet', () => {
		expect( () => designSheet( themeJsonDesign( {} ) ) ).toThrow( /at least two colors/ );
	} );

	describe.runIf( WORDPRESS )( "WordPress's default theme", () => {
		it( 'shows its palette, type and button', () => {
			const themeJson = JSON.parse(
				readFileSync(
					path.join( WORDPRESS!, 'wp-content/themes/twentytwentyfive/theme.json' ),
					'utf8'
				)
			);
			const sheet = designSheet( themeJsonDesign( themeJson ) );

			expect( sheet.background ).toBe( '#FFFFFF' );
			expect( sheet.text ).toBe( '#111111' );
			expect( sheet.colors.map( ( [ name ] ) => name ) ).toContain( 'accent-1' );
			expect( sheet.body.fontFamily ).toMatch( /Manrope/ );
			expect( sheet.button.backgroundColor ).toBe( '#111111' );
		} );
	} );
} );
