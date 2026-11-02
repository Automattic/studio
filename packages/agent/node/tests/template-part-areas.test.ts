import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import path from 'path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SiteChanges } from '@studio/agent/node/site-changes';
import { templatePartAreas } from '@studio/agent/node/template-part-areas';
import { createFakeHost } from '@studio/agent/node/tests/fake-host';
import { createSite } from '@studio/agent/node/tests/fixtures/wordpress-site';
import type { HostSite } from '@studio/agent/node/host';

let fixture: ReturnType< typeof createSite >;
let site: HostSite;

const write = ( file: string, content = '' ) => {
	const target = path.join( fixture.root, 'wp-content/themes', file );
	mkdirSync( path.dirname( target ), { recursive: true } );
	writeFileSync( target, content );
};
const part = ( attributes: object ) =>
	`<!-- wp:template-part ${ JSON.stringify( attributes ) } /-->`;
const HEADER = part( { slug: 'header', area: 'header' } );
const FOOTER = part( { slug: 'footer', area: 'footer' } );

beforeEach( () => {
	fixture = createSite();
	site = { id: '1', name: 'Yoga', path: fixture.root } as HostSite;
	// WordPress.org updates only the theme named "installed".
	vi.stubGlobal( 'fetch', async ( _url: string, init: { body: URLSearchParams } ) => {
		const { themes } = JSON.parse( init.body.get( 'themes' ) ?? '{}' );
		return new Response(
			JSON.stringify( { themes: {}, no_update: 'installed' in themes ? themes : {} } )
		);
	} );
} );

afterEach( () => {
	vi.unstubAllGlobals();
	rmSync( fixture.root, { recursive: true, force: true } );
} );

// WordPress gives a part file its area only from theme.json templateParts.
it.each( [
	{
		name: 'a header and footer the templates include',
		theme: 'yoga',
		json: { version: 3 },
		templates: { index: `${ HEADER }\n<!-- wp:post-content /-->\n${ FOOTER }`, page: HEADER },
		parts: [ 'header', 'footer' ],
		added: [
			{ area: 'header', name: 'header', title: 'Header' },
			{ area: 'footer', name: 'footer', title: 'Footer' },
		],
	},
	{
		name: 'a part another part includes, titled from its slug',
		theme: 'yoga',
		json: { version: 3, templateParts: [ { area: 'header', name: 'header', title: 'Top' } ] },
		templates: { index: HEADER },
		partFiles: { header: part( { slug: 'site-nav_overlay', area: 'navigation-overlay' } ) },
		parts: [ 'header', 'site-nav_overlay' ],
		added: [
			{ area: 'header', name: 'header', title: 'Top' },
			{ area: 'navigation-overlay', name: 'site-nav_overlay', title: 'Site nav overlay' },
		],
	},
	{
		name: 'a part declared with another area, which stays',
		theme: 'yoga',
		json: { version: 3, templateParts: [ { area: 'uncategorized', name: 'header' } ] },
		templates: { index: HEADER },
		parts: [ 'header' ],
		added: undefined,
	},
	{
		name: 'an area core does not define',
		theme: 'yoga',
		json: { version: 3 },
		templates: { index: part( { slug: 'sidebar', area: 'sidebar' } ) },
		parts: [ 'sidebar' ],
		added: undefined,
	},
	{
		name: 'a part with no file',
		theme: 'yoga',
		json: { version: 3 },
		templates: { index: HEADER },
		parts: [],
		added: undefined,
	},
	{
		name: "another theme's part",
		theme: 'yoga',
		json: { version: 3 },
		templates: { index: part( { slug: 'header', area: 'header', theme: 'other' } ) },
		parts: [ 'header' ],
		added: undefined,
	},
	{
		name: 'a theme the turn did not change',
		theme: 'yoga',
		json: { version: 3 },
		templates: { index: HEADER },
		parts: [ 'header' ],
		before: true,
		added: undefined,
	},
	{
		name: 'a theme WordPress updates',
		theme: 'installed',
		json: { version: 3 },
		templates: { index: HEADER },
		parts: [ 'header' ],
		added: undefined,
	},
] )( '$name', async ( { theme, json, templates, partFiles = {}, parts, before, added } ) => {
	const changes = new SiteChanges( createFakeHost(), undefined, async () => [ site ], [
		templatePartAreas,
	] );
	const writeTheme = () => {
		write( `${ theme }/style.css`, `/*\nTheme Name: ${ theme }\n*/` );
		write( `${ theme }/theme.json`, JSON.stringify( json ) );
		for ( const [ slug, markup ] of Object.entries( templates ) ) {
			write( `${ theme }/templates/${ slug }.html`, markup );
		}
		for ( const slug of parts ) {
			write( `${ theme }/parts/${ slug }.html`, partFiles[ slug as keyof typeof partFiles ] ?? '' );
		}
	};
	if ( before ) {
		writeTheme();
	}
	await changes.snapshot();
	if ( ! before ) {
		writeTheme();
	}
	const { summaries } = await changes.settle();

	const now = JSON.parse(
		readFileSync( path.join( fixture.root, 'wp-content/themes', theme, 'theme.json' ), 'utf8' )
	);
	expect( now.templateParts ).toEqual( added ?? json.templateParts );
	expect( summaries ).toHaveLength( added ? 1 : 0 );
	if ( added ) {
		expect( summaries[ 0 ] ).toContain( '_add_block_template_part_area_info()' );
		expect( summaries[ 0 ] ).toContain( `wp-content/themes/${ theme }/theme.json` );
	}
	// The theme.json Studio wrote is not changed again.
	await changes.snapshot();
	expect( ( await changes.settle() ).summaries ).toEqual( [] );
} );
