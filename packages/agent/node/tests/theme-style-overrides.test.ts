import { mkdirSync, writeFileSync } from 'fs';
import path from 'path';
import { expect, it } from 'vitest';
import { createSiteNotes } from '@studio/agent/node/site-notes';
import { createFakeHost } from '@studio/agent/node/tests/fake-host';
import { createSite } from '@studio/agent/node/tests/fixtures/wordpress-site';

const heading = ( level: number | undefined, typography: Record< string, string > ) =>
	`<!-- wp:heading ${ JSON.stringify( {
		...( level ? { level } : {} ),
		style: { typography },
	} ) } -->\n<h${ level ?? 2 } class="wp-block-heading">Visit us</h${
		level ?? 2
	}>\n<!-- /wp:heading -->`;

// A theme.json style shows on no block that sets the same property itself,
// as the footer's uppercase h3s kept a lowercase request from showing.
it( 'notes the blocks a theme.json write changes a style for and does not reach', async () => {
	const site = createSite();
	const blocks = path.join( site.root, 'wp-includes/blocks/heading' );
	mkdirSync( blocks, { recursive: true } );
	writeFileSync(
		path.join( blocks, 'block.json' ),
		JSON.stringify( {
			name: 'core/heading',
			attributes: { level: { type: 'number', default: 2 } },
		} )
	);
	const theme = path.join( site.root, 'wp-content/themes/bakery' );
	mkdirSync( path.join( theme, 'parts' ) );
	writeFileSync(
		path.join( theme, 'parts/footer.html' ),
		[
			heading( 3, { textTransform: 'uppercase' } ),
			heading( 3, { textTransform: 'uppercase' } ),
			heading( 3, { textTransform: 'lowercase' } ),
			heading( undefined, { textTransform: 'uppercase' } ),
		].join( '\n' )
	);
	const notes = createSiteNotes( createFakeHost() );
	const themeJson = path.join( theme, 'theme.json' );
	// A file tool's write, which Studio sees before it runs, or another's, which it does not.
	const write = async ( styles: object, byFileTool = true ) => {
		if ( byFileTool ) {
			await notes.beforeWrite( themeJson );
		}
		writeFileSync( themeJson, JSON.stringify( { version: 3, styles } ) );
		return ( await notes.afterWrite( themeJson ) ).filter( ( note ) =>
			note.includes( 'that set their own' )
		);
	};
	const h3 = { elements: { h3: { typography: { textTransform: 'lowercase' } } } };
	expect( await write( h3 ) ).toEqual( [
		expect.stringContaining(
			'styles.elements.h3.typography.textTransform lowercase does not show on 2 blocks that set their own: core/heading uppercase in parts/footer.html (2).'
		),
	] );
	expect( await write( { ...h3, color: { text: '#000' } } ) ).toEqual( [] );
	const none = { elements: { heading: { typography: { textTransform: 'none' } } } };
	expect( await write( none, false ) ).toEqual( [] );
	expect(
		await write( {
			elements: {
				heading: { typography: { textTransform: 'none' }, color: { text: '#111' } },
				h1: {},
			},
		} )
	).toEqual( [] );
	expect(
		await write( { elements: { heading: { typography: { textTransform: 'capitalize' } } } } )
	).toEqual( [
		expect.stringContaining(
			'4 blocks that set their own: core/heading uppercase in parts/footer.html (3), core/heading lowercase in parts/footer.html (1)'
		),
	] );
} );
