import { describe, expect, it } from 'vitest';
import {
	applyDesignToThemeJson,
	applyThemeToDesign,
	designDrift,
	googleFontsUrl,
	parseDesignMd,
	themeJsonFromDesign,
	typographyStyles,
} from './index';

const DESIGN_MD = `---
name: Sunny Bakery
colors:
  primary: "#e2231a"
  background: "#fffdf7"
  text: "#111111"
  accent-warm: "#f6c344"
typography:
  display:
    fontFamily: "'Fredoka', system-ui, sans-serif"
    fontSize: "clamp(3rem, 9vw, 8rem)"
    fontWeight: 800
    lineHeight: 0.95
  headline:
    fontFamily: "'Fredoka', system-ui, sans-serif"
    fontSize: "2rem"
    fontWeight: 700
    lineHeight: 1.05
    letterSpacing: "-0.02em"
  body:
    fontFamily: "Nunito, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Nunito, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 700
    textTransform: "uppercase"
rounded:
  none: 0
  pill: 999px
spacing:
  sm: 16px
  md: 32px
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "#ffffff"
    rounded: "{rounded.pill}"
    padding: "{spacing.sm} {spacing.md}"
---

# Sunny Bakery
`;

const BASE = { version: 3, styles: { spacing: { padding: { top: '0px' } } } };

describe( 'parseDesignMd', () => {
	it( 'rejects a document without front matter and one that never closes it', () => {
		expect( () => parseDesignMd( '# No front matter\n' ) ).toThrow(
			/must start with YAML front matter/
		);
		expect( () => parseDesignMd( '---\nname: Open\n# prose' ) ).toThrow( /never closed/ );
	} );
} );

describe( 'themeJsonFromDesign', () => {
	it( 'maps the tokens onto theme.json and a Google Fonts URL', () => {
		const tokens = parseDesignMd( DESIGN_MD );
		const result = themeJsonFromDesign( tokens, BASE );
		expect( result ).toBeDefined();
		const { themeJson, fontsUrl, summary } = result!;

		expect( themeJson ).toEqual( {
			version: 3,
			settings: {
				color: {
					palette: [
						{ slug: 'primary', color: '#e2231a', name: 'Primary' },
						{ slug: 'background', color: '#fffdf7', name: 'Background' },
						{ slug: 'text', color: '#111111', name: 'Text' },
						{ slug: 'accent-warm', color: '#f6c344', name: 'Accent Warm' },
					],
				},
				typography: {
					fontFamilies: [
						{ slug: 'fredoka', name: 'Fredoka', fontFamily: '"Fredoka", system-ui, sans-serif' },
						{ slug: 'nunito', name: 'Nunito', fontFamily: '"Nunito", sans-serif' },
					],
					fontSizes: [
						{ slug: 'display', size: 'clamp(3rem, 9vw, 8rem)', name: 'Display' },
						{ slug: 'headline', size: '2rem', name: 'Headline' },
						{ slug: 'body', size: '1rem', name: 'Body' },
						{ slug: 'label', size: '0.75rem', name: 'Label' },
					],
				},
				spacing: {
					spacingSizes: [
						{ slug: 'sm', size: '16px', name: 'Small' },
						{ slug: 'md', size: '32px', name: 'Medium' },
					],
				},
				custom: { rounded: { none: '0px', pill: '999px' } },
			},
			styles: {
				spacing: { padding: { top: '0px' } },
				color: { background: 'var:preset|color|background', text: 'var:preset|color|text' },
				typography: {
					fontFamily: 'var:preset|font-family|nunito',
					fontSize: 'var:preset|font-size|body',
					fontWeight: '400',
					lineHeight: '1.5',
				},
				elements: {
					heading: {
						typography: {
							fontFamily: 'var:preset|font-family|fredoka',
							fontWeight: '700',
							lineHeight: '1.05',
							letterSpacing: '-0.02em',
						},
					},
					link: { color: { text: 'var:preset|color|primary' } },
					button: {
						color: { background: 'var:preset|color|primary', text: '#ffffff' },
						border: { radius: '999px' },
						spacing: {
							padding: {
								top: 'var:preset|spacing|sm',
								right: 'var:preset|spacing|md',
								bottom: 'var:preset|spacing|sm',
								left: 'var:preset|spacing|md',
							},
						},
						typography: {
							fontFamily: 'var:preset|font-family|nunito',
							fontSize: 'var:preset|font-size|label',
							fontWeight: '700',
							textTransform: 'uppercase',
						},
					},
				},
			},
		} );
		expect( fontsUrl ).toBe(
			'https://fonts.googleapis.com/css2?family=Fredoka:wght@700;800&family=Nunito:wght@400;700&display=swap'
		);
		expect( summary ).toBe( '4 colors, 2 font families, 4 text styles, 2 spacing steps' );
	} );

	it( 'returns undefined when the tokens have no colors', () => {
		expect(
			themeJsonFromDesign( parseDesignMd( '---\nname: Empty\n---\n# Empty\n' ), BASE )
		).toBeUndefined();
	} );
} );

describe( 'googleFontsUrl', () => {
	it( 'honors the display strategy and returns undefined without families', () => {
		const styles = typographyStyles( parseDesignMd( DESIGN_MD ) ).map( ( [ , style ] ) => style );
		expect( googleFontsUrl( styles, 'block' ) ).toMatch( /&display=block$/ );
		expect( googleFontsUrl( [] ) ).toBeUndefined();
	} );
} );

const FONT_FACES = {
	Fredoka: [ { fontFamily: 'Fredoka', src: [ 'file:./assets/fonts/fredoka.woff2' ] } ],
	Nunito: [ { fontFamily: 'Nunito', src: [ 'file:./assets/fonts/nunito.woff2' ] } ],
};

describe( 'designDrift', () => {
	it( 'lists the tokens theme.json lacks or sets differently, and fonts without files', () => {
		const tokens = parseDesignMd( DESIGN_MD );
		const themeJson = themeJsonFromDesign( tokens, BASE, FONT_FACES )!.themeJson;
		expect( designDrift( tokens, themeJson ) ).toEqual( [] );
		expect(
			designDrift( tokens, {
				settings: { color: { palette: [ { slug: 'base', color: '#fff' } ] } },
			} )
		).toEqual( [] );

		const settings = themeJson.settings as {
			color: { palette: Array< { slug: string; color: string } > };
			spacing: { spacingSizes: unknown[] };
			typography: { fontFamilies: Array< { fontFace?: unknown } > };
		};
		settings.color.palette[ 0 ].color = '#E2231A';
		settings.color.palette[ 1 ].color = '#000000';
		settings.spacing.spacingSizes = [];
		delete settings.typography.fontFamilies[ 1 ].fontFace;
		expect( designDrift( tokens, themeJson ) ).toEqual( [
			{ kind: 'color', slug: 'background', design: '#fffdf7', theme: '#000000' },
			{ kind: 'spacing', slug: 'sm', design: '16px', theme: undefined },
			{ kind: 'spacing', slug: 'md', design: '32px', theme: undefined },
			{ kind: 'font-files', slug: 'nunito', design: 'Nunito' },
		] );
	} );
} );

describe( 'applying drift', () => {
	const tokens = parseDesignMd( DESIGN_MD );
	const drifted = () => {
		const themeJson = themeJsonFromDesign( tokens, BASE, FONT_FACES )!.themeJson;
		const settings = themeJson.settings as {
			color: { palette: Array< { slug: string; color: string } > };
			spacing: { spacingSizes: unknown[] };
		};
		settings.color.palette[ 1 ].color = '#000000';
		settings.color.palette.push( { slug: 'extra', color: '#123456' } );
		settings.spacing.spacingSizes = [];
		return themeJson;
	};

	it( 'writes the DESIGN.md values into theme.json and keeps its other presets', () => {
		const themeJson = drifted();
		const fixed = applyDesignToThemeJson( tokens, themeJson, designDrift( tokens, themeJson ) );
		expect( designDrift( tokens, fixed ) ).toEqual( [] );
		expect( ( fixed.settings as { color: { palette: unknown[] } } ).color.palette ).toContainEqual(
			{ slug: 'extra', color: '#123456' }
		);
		expect( fixed.styles ).toEqual( themeJson.styles );
	} );

	it( 'writes theme.json values back into the front matter and leaves the rest as written', () => {
		const design = applyThemeToDesign( DESIGN_MD, designDrift( tokens, drifted() ) );
		expect( design ).toBe( DESIGN_MD.replace( 'background: "#fffdf7"', 'background: "#000000"' ) );
	} );
} );
