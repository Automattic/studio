import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import os from 'os';
import path from 'path';
import { themeJsonFileRead } from '@studio/agent/node/theme-json-files';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { liveHost, liveSite } from 'cli/ai/tests/live-host';
import type { HostSite, StudioAgentHost } from '@studio/agent/node';

// A real WordPress install to read themes with, when one is given.
const WORDPRESS = process.env.STUDIO_TEST_WORDPRESS;

describe.runIf( WORDPRESS )( 'what WordPress makes of a theme.json just written', () => {
	let site: HostSite;
	let host: StudioAgentHost;
	let file: string;
	const read = async ( json: object ) => {
		writeFileSync( file, JSON.stringify( json ) );
		return ( await themeJsonFileRead( host, site, file, 'theme.json' ) ).problem;
	};
	beforeAll( () => {
		const root = mkdtempSync( path.join( os.tmpdir(), 'theme-json-files-' ) );
		cpSync( WORDPRESS!, root, { recursive: true } );
		site = liveSite( root );
		host = liveHost( site );
		const dir = path.join( root, 'wp-content/themes/gym' );
		mkdirSync( dir, { recursive: true } );
		file = path.join( dir, 'theme.json' );
	} );
	afterAll( () => rmSync( site.path, { recursive: true, force: true } ) );

	// port eval24 redo: an edit left "css" without its closing quote, and a CSS escape is no JSON escape.
	it.each( [
		[
			'{\n\t"styles": {\n\t\t"css": ".a{animation:none}\n\t\t"spacing": {}\n\t}\n}',
			'line 3, column 29 (Bad control character in string literal): `…"styles": {\\n\\t\\t"css": ".a{animation:none}\\n\\t\\t"spacing"',
		],
		[
			'{ "styles": { "css": "a::before{content:\'\\2726\'}" } }',
			'line 1, column 43 (Bad escaped character)',
		],
	] )(
		'says where the file stops parsing as JSON',
		async ( text, at ) => {
			writeFileSync( file, text );
			expect( ( await themeJsonFileRead( host, site, file, 'theme.json' ) ).problem ).toContain(
				`. It reads nothing from it until the file is valid JSON. JSON parsing stops at ${ at }`
			);
		},
		60000
	);

	// port c-2 climbing-gym: a "spacingScale" of 1.4 failed every page once the theme was active.
	it( 'says what the read throws, and nothing once the value has its form', async () => {
		expect( await read( { version: 3, settings: { spacing: { spacingScale: 1.4 } } } ) ).toMatch(
			/^WordPress fails reading theme\.json as new WP_Theme_JSON\( \$decoded \) .*: TypeError: array_keys\(\): Argument #1 \(\$array\) must be of type array, float given in wp-includes\/class-wp-theme-json\.php:\d+\./
		);
		// The theme active, as the theme whose read fails each request.
		writeFileSync( path.join( path.dirname( file ), 'style.css' ), '/*\nTheme Name: Gym\n*/\n' );
		mkdirSync( path.join( path.dirname( file ), 'templates' ), { recursive: true } );
		writeFileSync( path.join( path.dirname( file ), 'templates/index.html' ), '' );
		await host.sites.wpCli( site, [ 'theme', 'activate', 'gym' ] );
		expect( await read( { version: 3, settings: { spacing: { spacingScale: 1.4 } } } ) ).toMatch(
			/^WordPress fails reading theme\.json .*TypeError: array_keys/
		);
		expect(
			await read( { version: 3, settings: { spacing: { spacingScale: { steps: 0 } } } } )
		).toBeUndefined();
	}, 60000 );

	// port eval30 onepage: the note named the elements, which the schema has, for the keys
	// under them it has no place for, and the model left them as harmless no-ops.
	it( 'names the keys WordPress removes, not the elements they are under', async () => {
		const problem = await read( {
			$schema: 'https://schemas.wp.org/trunk/theme.json',
			version: 3,
			settings: { appearanceTools: true, layout: { contentSize: '720px', wideSize: '1200px' } },
			styles: {
				color: { background: '#ffffff', text: '#1f2b38' },
				typography: { fontSize: '1.05rem', lineHeight: '1.65' },
				elements: {
					heading: {
						color: '#12314f',
						fontWeight: '600',
						lineHeight: '1.12',
						letterSpacing: '-0.02em',
					},
					h1: { fontSize: 'var:preset|font-size|xx-large' },
					h2: { fontSize: 'var:preset|font-size|x-large' },
					h3: { fontSize: 'var:preset|font-size|large' },
					link: { color: '#2a7fb8', textDecoration: 'underline' },
					button: {
						color: { background: '#2a7fb8', text: '#ffffff' },
						border: { radius: '999px' },
						typography: { fontWeight: '600' },
					},
					image: { border: { radius: '12px' } },
				},
			},
			templateParts: [ { name: 'header', title: 'Header', area: 'header' } ],
		} );
		expect( problem ).toContain(
			'so these change nothing on the site: styles.elements.heading.color, styles.elements.heading.fontWeight, styles.elements.heading.lineHeight, styles.elements.heading.letterSpacing, styles.elements.h1.fontSize, styles.elements.h2.fontSize, styles.elements.h3.fontSize, styles.elements.link.color, styles.elements.link.textDecoration, styles.elements.image. The schema'
		);
	}, 60000 );
} );
