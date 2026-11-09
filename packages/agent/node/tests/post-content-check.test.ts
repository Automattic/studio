import { writeFileSync } from 'fs';
import { DatabaseSync } from 'node:sqlite';
import path from 'path';
import { describe, expect, it, vi } from 'vitest';
import { OpenProblems } from '@studio/agent/node/open-problems';
import { postContentChanges } from '@studio/agent/node/post-content-check';
import { SiteChanges } from '@studio/agent/node/site-changes';
import { createFakeHost } from '@studio/agent/node/tests/fake-host';
import { createSite } from '@studio/agent/node/tests/fixtures/wordpress-site';
import type { HostSite } from '@studio/agent/node/host';

// The block editor, which the unit tests do not load: every block is valid,
// and its save changes nothing.
vi.mock( '@studio/agent/node/block-validator', async () => ( {
	...( await vi.importActual< typeof import('@studio/agent/node/block-validator') >(
		'@studio/agent/node/block-validator'
	) ),
	validateBlocks: vi.fn( async () => ( {
		totalBlocks: 1,
		validBlocks: 1,
		invalidBlocks: 0,
		results: [],
	} ) ),
	storePresetValues: vi.fn( async ( content: string ) => ( {
		content,
		colors: [],
		fontSizes: [],
		spacingSizes: [],
	} ) ),
	bindNavigationLinks: vi.fn( async ( content: string ) => ( { content, links: [] } ) ),
} ) );

// A site whose post checks record their problems, and whose WordPress
// resolves the color presets the test sets.
function setup() {
	const site = createSite();
	const hostSite = {
		id: 'bakery',
		path: site.root,
		url: 'http://localhost:8881',
		name: 'Bakery',
	} as HostSite;
	const colors: Array< [ string, string ] > = [ [ 'base', '#ffffff' ] ];
	const host = createFakeHost();
	vi.mocked( host.sites.resolve ).mockResolvedValue( hostSite );
	vi.mocked( host.sites.wpCli ).mockImplementation( async () => ( {
		exitCode: 0,
		stdout: JSON.stringify( { colors, fontSizes: [], spacingSizes: [] } ),
		stderr: '',
	} ) );
	const open = new OpenProblems( [] );
	const changes = new SiteChanges( host, open, async () => [ hostSite ], [ postContentChanges ] );
	return { site, colors, open, changes };
}

describe( 'postContentChanges', () => {
	// eval28 redo1: page 35, deleted, kept its unclosed block open in later checks.
	it( 'leaves no problem open for a post deleted or trashed', async () => {
		const { site, open, changes } = setup();
		site.save( 35, 'page', 'home', '', 1, 'publish', 'Home' );
		site.save( 36, 'page', 'about', '', 1, 'publish', 'About' );
		await changes.snapshot();
		site.edit( 35, '<!-- wp:group --><div class="wp-block-group">' );
		site.edit( 36, '<!-- wp:group --><div class="wp-block-group">' );
		expect( ( await changes.settle() ).problems ).toHaveLength( 2 );
		open.look();

		const db = new DatabaseSync( path.join( site.root, 'wp-content/database/.ht.sqlite' ) );
		db.exec( "DELETE FROM wp_posts WHERE ID = 35; UPDATE wp_posts SET post_status = 'trash'" );
		db.close();
		expect( await changes.settle() ).toEqual( { summaries: [], problems: [], written: [] } );
		expect( open.look() ).toEqual( [] );
	} );

	// eval26 redo1: pages 14 and 17 named colors the model then added to
	// theme.json, and their problems stayed open, naming the old palette.
	it( 'validates a post left with a problem again once the presets change, without a note', async () => {
		const { site, colors, open, changes } = setup();
		site.save( 14, 'page', 'home', '', 1, 'publish', 'Home' );
		await changes.snapshot();
		site.edit(
			14,
			'<!-- wp:group {"backgroundColor":"deep"} -->\n<div class="wp-block-group has-deep-background-color has-background"></div>\n<!-- /wp:group -->'
		);
		const [ problem ] = ( await changes.settle() ).problems;
		expect( problem ).toContain( 'line 1: core/group color deep' );
		expect( open.look() ).toEqual( [] );

		colors.push( [ 'deep', '#0b2a3a' ] );
		writeFileSync(
			path.join( site.root, 'wp-content/themes/bakery/theme.json' ),
			'{ "version": 3, "settings": { "color": { "palette": [ { "slug": "deep" } ] } } }'
		);
		expect( await changes.settle() ).toEqual( { summaries: [], problems: [], written: [] } );
		expect( open.look() ).toEqual( [] );
		expect( await open.raise() ).toEqual( [] );
	} );
} );
