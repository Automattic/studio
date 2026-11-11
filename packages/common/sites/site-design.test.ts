import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { nodeSiteFiles } from './node-site-files';
import { fixSiteDesign, readSiteDesign } from './site-design';

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
				typography: { fontFamilies: [] },
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
	const result = await fixSiteDesign( nodeSiteFiles( sitePath ), async () => 'bakery', [
		{ kind: 'color', slug: 'primary', to: 'theme' },
		{ kind: 'color', slug: 'background', to: 'design' },
		{ kind: 'font-family', slug: 'inter', to: 'theme' },
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

it( 'shows WordPress styles when DESIGN.md is missing without creating a document', async () => {
	await rm( path.join( sitePath, 'DESIGN.md' ) );
	const themeJson = { settings: { color: { palette: [] } }, styles: {} };
	const resolveTheme = vi.fn();
	const result = await readSiteDesign(
		nodeSiteFiles( sitePath ),
		resolveTheme,
		async () => themeJson
	);
	expect( result ).toEqual( { design: null, themeJson } );
	expect( resolveTheme ).not.toHaveBeenCalled();
	await expect( readFile( path.join( sitePath, 'DESIGN.md' ) ) ).rejects.toThrow();
} );

it( 'preserves an existing DESIGN.md board and its theme comparison', async () => {
	const fallback = vi.fn();
	const result = await readSiteDesign( nodeSiteFiles( sitePath ), async () => 'bakery', fallback );
	expect( result?.design ).toBe( DESIGN_MD );
	expect( result?.themeJson ).toMatchObject( { version: 3 } );
	expect( fallback ).not.toHaveBeenCalled();
} );

it.each( [
	[
		'missing typography tokens',
		'---\ncolors:\n  background: "#333333"\n  text: "#F5F5F5"\n---\n\n## Typography\nUse Inter throughout.',
	],
	[ 'missing colors', '---\ntypography:\n  body:\n    fontFamily: Inter\n---' ],
	[ 'missing front matter', '# Design system\nUse charcoal backgrounds and Inter.' ],
	[ 'invalid YAML', '---\ncolors: [\n---' ],
] )( 'falls back to WordPress styles for DESIGN.md with %s', async ( _, document ) => {
	await writeFile( path.join( sitePath, 'DESIGN.md' ), document );
	const themeJson = { settings: {}, styles: { color: { background: '#333333' } } };
	const fallback = vi.fn( async () => themeJson );

	const result = await readSiteDesign( nodeSiteFiles( sitePath ), async () => 'bakery', fallback );

	expect( result ).toEqual( { design: null, themeJson } );
	expect( fallback ).toHaveBeenCalledOnce();
	expect( await readFile( path.join( sitePath, 'DESIGN.md' ), 'utf8' ) ).toBe( document );
} );

it( 'uses resolved styles for child themes without their own theme.json', async () => {
	await rm( path.join( themeDir(), 'theme.json' ) );
	const themeJson = { settings: {}, styles: { color: { text: '#123456' } } };
	const result = await readSiteDesign(
		nodeSiteFiles( sitePath ),
		async () => 'bakery',
		async () => themeJson
	);
	expect( result ).toEqual( { design: null, themeJson } );
} );

it( 'returns no board for a classic theme without DESIGN.md', async () => {
	await rm( path.join( sitePath, 'DESIGN.md' ) );
	expect( await readSiteDesign( nodeSiteFiles( sitePath ), vi.fn(), async () => null ) ).toBeNull();
} );

it( 'propagates a WordPress read failure instead of reporting a missing design', async () => {
	await rm( path.join( sitePath, 'DESIGN.md' ) );
	await expect(
		readSiteDesign( nodeSiteFiles( sitePath ), vi.fn(), async () => {
			throw new Error( 'WordPress unavailable' );
		} )
	).rejects.toThrow( 'WordPress unavailable' );
} );
