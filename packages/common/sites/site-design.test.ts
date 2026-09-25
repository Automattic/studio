import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { fixSiteDesign } from './site-design';

const DESIGN_MD = `---
colors:
  primary: "#c2552b"
  background: "#fbf6ee"
typography:
  body:
    fontFamily: "Inter"
    fontWeight: 400
---

# Overview
`;

let sitePath: string;
const themeDir = () => path.join( sitePath, 'wp-content', 'themes', 'bakery' );

beforeEach( async () => {
	sitePath = await mkdtemp( path.join( os.tmpdir(), 'studio-site-design-' ) );
	await mkdir( themeDir(), { recursive: true } );
	await writeFile( path.join( sitePath, 'DESIGN.md' ), DESIGN_MD );
	await writeFile(
		path.join( themeDir(), 'theme.json' ),
		JSON.stringify( {
			version: 3,
			settings: {
				color: {
					palette: [
						{ slug: 'primary', color: '#b84a22', name: 'Primary' },
						{ slug: 'background', color: '#ffffff', name: 'Background' },
					],
				},
				typography: {
					fontFamilies: [ { slug: 'inter', name: 'Inter', fontFamily: '"Inter", sans-serif' } ],
				},
			},
		} )
	);
	vi.stubGlobal(
		'fetch',
		vi.fn( async ( url: string ) =>
			url.startsWith( 'https://fonts.googleapis.com/' )
				? new Response(
						"/* latin */\n@font-face {\n  font-family: 'Inter';\n  font-style: normal;\n  font-weight: 400;\n  src: url(https://fonts.gstatic.com/inter.woff2) format('woff2');\n}\n"
				  )
				: new Response( new Uint8Array( [ 1 ] ) )
		)
	);
} );

afterEach( async () => {
	vi.unstubAllGlobals();
	await rm( sitePath, { recursive: true, force: true } );
} );

it( 'settles each drift in the direction its fix names', async () => {
	const result = await fixSiteDesign( sitePath, async () => 'bakery', [
		{ kind: 'color', slug: 'primary', to: 'theme' },
		{ kind: 'color', slug: 'background', to: 'design' },
		{ kind: 'font-files', slug: 'inter', to: 'theme' },
	] );

	expect( result?.design ).toBe( DESIGN_MD.replace( '#fbf6ee', '#ffffff' ) );
	const settings = result?.themeJson.settings as {
		color: { palette: Array< { color: string } > };
		typography: { fontFamilies: Array< { fontFace: unknown } > };
	};
	expect( settings.color.palette.map( ( { color } ) => color ) ).toEqual( [
		'#c2552b',
		'#ffffff',
	] );
	expect( settings.typography.fontFamilies[ 0 ].fontFace ).toEqual( [
		{
			fontFamily: 'Inter',
			fontStyle: 'normal',
			fontWeight: '400',
			src: [ 'file:./assets/fonts/inter/inter-400-latin.woff2' ],
		},
	] );
	await expect(
		readFile( path.join( themeDir(), 'assets/fonts/inter/inter-400-latin.woff2' ) )
	).resolves.toEqual( Buffer.from( [ 1 ] ) );
} );
