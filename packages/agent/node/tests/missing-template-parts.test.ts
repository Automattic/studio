import { mkdirSync, rmSync, writeFileSync } from 'fs';
import path from 'path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { missingTemplateParts } from '@studio/agent/node/missing-template-parts';
import { createFakeHost } from '@studio/agent/node/tests/fake-host';
import { createSite } from '@studio/agent/node/tests/fixtures/wordpress-site';
import type { HostSite } from '@studio/agent/node/host';

let fixture: ReturnType< typeof createSite >;
let site: HostSite;
const host = createFakeHost();

const write = ( file: string, content = '' ) => {
	const target = path.join( fixture.root, 'wp-content/themes', file );
	mkdirSync( path.dirname( target ), { recursive: true } );
	writeFileSync( target, content );
};
const part = ( attributes: object ) =>
	`<!-- wp:template-part ${ JSON.stringify( attributes ) } /-->`;

beforeEach( () => {
	fixture = createSite();
	site = { id: '1', name: 'Bakery', path: fixture.root } as HostSite;
} );

afterEach( () => rmSync( fixture.root, { recursive: true, force: true } ) );

// The fixture's site saves a wp_template_part only for the theme "bakery".
it.each< { name: string; files: Record< string, string >; saved?: string; reported?: string[] } >( [
	{
		name: 'a part written where WordPress reads templates',
		files: { 'templates/header.html': '' },
		reported: [ 'the template part header', 'templates/header.html is a template' ],
	},
	{
		name: "another theme's part",
		files: { 'parts/header.html': '' },
		saved: part( { slug: 'header', theme: 'twentytwentyfive' } ),
		reported: [ 'header of the theme twentytwentyfive' ],
	},
	{ name: 'a part file of the theme', files: { 'parts/header.html': '' } },
	{
		name: "a part file of the theme's parent",
		files: { 'style.css': '/*\nTemplate: bakery-parent\n*/' },
	},
	{ name: 'a part saved to the site', files: {}, saved: 'saved' },
] )( '$name', async ( { files, saved, reported } ) => {
	write( 'bakery-parent/parts/header.html' );
	const before = await missingTemplateParts.read( site.path, undefined, host );
	const template = saved && saved !== 'saved' ? saved : part( { slug: 'header' } );
	write( 'bakery/templates/index.html', template );
	for ( const [ file, content ] of Object.entries( files ) ) {
		write( `bakery/${ file }`, content );
	}
	if ( saved === 'saved' ) {
		fixture.save( 10, 'wp_template_part', 'header' );
	}
	if ( ! files[ 'style.css' ] ) {
		rmSync( path.join( fixture.root, 'wp-content/themes/bakery-parent/parts' ), {
			recursive: true,
		} );
	}
	const after = await missingTemplateParts.read( site.path, before, host );
	const { reports } = await missingTemplateParts.check( site, before, after, host );
	const report = reports.find( ( { key } ) => key === 'missing template parts of bakery' );
	for ( const text of reported ?? [] ) {
		expect( report?.problem ).toContain( text );
		expect( report?.summary ).toContain( text );
	}
	if ( ! reported ) {
		expect( report?.problem ).toBeUndefined();
	}
} );

it( 'resolves the problem once the part is written', async () => {
	write( 'bakery/templates/index.html', part( { slug: 'footer' } ) );
	const missing = await missingTemplateParts.read( site.path, undefined, host );
	write( 'bakery/parts/footer.html' );
	const { reports } = await missingTemplateParts.check(
		site,
		missing,
		await missingTemplateParts.read( site.path, missing, host ),
		host
	);
	expect( reports ).toEqual( [
		expect.objectContaining( { problem: undefined, summary: undefined } ),
	] );
} );
