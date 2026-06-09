import { describe, expect, it } from 'vitest';
import { renderFunctionsPhp } from 'cli/ai/tools/generate-theme';

describe( 'renderFunctionsPhp', () => {
	it( 'prefers the selected design Google Fonts URL when one is present', () => {
		const themeJson = JSON.stringify( {
			settings: {
				typography: {
					fontFamilies: [
						{
							slug: 'body',
							fontFamily: 'Inter, system-ui, sans-serif',
						},
					],
				},
			},
		} );
		const design =
			'<link href="https://fonts.googleapis.com/css2?family=Pacifico&family=Nunito:wght@400;700&display=swap" rel="stylesheet">';

		const php = renderFunctionsPhp( 'Dijon Bike', 'dijon-bike', themeJson, design );

		expect( php ).toContain(
			'https://fonts.googleapis.com/css2?family=Pacifico&family=Nunito:wght@400;700&display=swap'
		);
		expect( php ).not.toContain( 'family=Inter' );
	} );

	it( 'enqueues Google Fonts from non-generic theme.json font families', () => {
		const themeJson = JSON.stringify( {
			settings: {
				typography: {
					fontFamilies: [
						{
							slug: 'heading',
							fontFamily: '"Playfair Display", Georgia, serif',
						},
						{
							slug: 'body',
							fontFamily: 'Inter, system-ui, sans-serif',
						},
						{
							slug: 'system',
							fontFamily: 'system-ui, sans-serif',
						},
					],
				},
			},
		} );

		const php = renderFunctionsPhp( 'Dijon Bike', 'dijon-bike', themeJson );

		expect( php ).toContain( "add_action( 'enqueue_block_assets'" );
		expect( php ).toContain( "'dijon-bike-fonts'" );
		expect( php ).toContain(
			'https://fonts.googleapis.com/css2?family=Playfair+Display&family=Inter&display=swap'
		);
		expect( php ).toContain( "'dijon-bike-style'" );
	} );

	it( 'skips Google Fonts when only generic/system families are declared', () => {
		const themeJson = JSON.stringify( {
			settings: {
				typography: {
					fontFamilies: [
						{
							slug: 'body',
							fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
						},
					],
				},
			},
		} );

		const php = renderFunctionsPhp( 'Plain Theme', 'plain-theme', themeJson );

		expect( php ).not.toContain( 'fonts.googleapis.com' );
		expect( php ).not.toContain( "'plain-theme-fonts'" );
		expect( php ).toContain( "'plain-theme-style'" );
	} );
} );
