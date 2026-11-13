import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import os from 'os';
import path from 'path';
import { savedCopiesFact } from '@studio/agent/node/saved-copies';
import { readWordPressSite } from '@studio/agent/node/site-database';
import { wpEvalJson } from '@studio/agent/shared/tools/utils';
import { afterAll, describe, expect, it } from 'vitest';
import { liveHost, liveSite } from 'cli/ai/tests/live-host';

// A real WordPress install to find the theme files with, when one is given.
const WORDPRESS = process.env.STUDIO_TEST_WORDPRESS;

describe.runIf( WORDPRESS )( 'the copies saved in the Site Editor', () => {
	const root = mkdtempSync( path.join( os.tmpdir(), 'saved-copies-' ) );
	afterAll( () => rmSync( root, { recursive: true, force: true } ) );

	it( 'names the theme file each replaces, where the theme has one', async () => {
		cpSync( WORDPRESS!, root, { recursive: true } );
		const site = liveSite( root, 'Bakery' );
		const host = liveHost( site );
		for ( const [ file, content ] of [
			[ 'bakery-parent/style.css', '/*\nTheme Name: Bakery Parent\n*/' ],
			[ 'bakery-parent/templates/index.html', '' ],
			[ 'bakery-parent/parts/header.html', '' ],
			[ 'bakery/style.css', '/*\nTheme Name: Bakery\nTemplate: bakery-parent\n*/' ],
		] ) {
			const target = path.join( root, 'wp-content/themes', file );
			mkdirSync( path.dirname( target ), { recursive: true } );
			writeFileSync( target, content );
		}
		const ids = await wpEvalJson< Record< string, number > >(
			host,
			site,
			[
				'switch_theme( "bakery" );',
				'$ids = array();',
				'foreach ( array( "wp_template_part" => "header", "wp_template" => "landing" ) as $type => $slug ) {',
				'	$ids[ $slug ] = wp_insert_post( array( "post_type" => $type, "post_status" => "publish", "post_name" => $slug, "post_title" => $slug ) );',
				'	wp_set_post_terms( $ids[ $slug ], "bakery", "wp_theme" );',
				'}',
				'echo wp_json_encode( $ids );',
			].join( '\n' )
		);
		expect( await readWordPressSite( root, ( wp ) => savedCopiesFact( wp, host ) ) ).toBe(
			`Saved in the Site Editor, so WordPress renders them in place of the active theme's files: the template landing (post ${ ids.landing }); the template part header (post ${ ids.header }), instead of parts/header.html.`
		);
	}, 120000 );
} );
