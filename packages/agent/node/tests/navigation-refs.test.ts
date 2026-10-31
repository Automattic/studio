import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { DatabaseSync } from 'node:sqlite';
import path from 'path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { navigationRefs } from '@studio/agent/node/navigation-refs';
import { createFakeHost } from '@studio/agent/node/tests/fake-host';
import { createSite } from '@studio/agent/node/tests/fixtures/wordpress-site';
import type { HostSite } from '@studio/agent/node/host';

let fixture: ReturnType< typeof createSite >;
let site: HostSite;
const host = createFakeHost();

const header = ( ref: number ) => {
	const file = path.join( fixture.root, 'wp-content/themes/bakery/parts/header.html' );
	mkdirSync( path.dirname( file ), { recursive: true } );
	writeFileSync(
		file,
		`<!-- wp:navigation {"ref":${ ref },"overlayMenu":"mobile"} --><!-- wp:page-list /--><!-- /wp:navigation -->`
	);
};
const sql = ( statements: string ) => {
	const db = new DatabaseSync( path.join( fixture.root, 'wp-content/database/.ht.sqlite' ) );
	db.exec( statements );
	db.close();
};
const check = async ( write: () => void ) => {
	const before = await navigationRefs.read( site.path, undefined, host );
	write();
	const after = await navigationRefs.read( site.path, before, host );
	const { reports } = await navigationRefs.check( site, before, after, host );
	return reports.find( ( report ) => report.key.includes( 'parts/header.html' ) );
};

beforeEach( () => {
	fixture = createSite();
	site = { id: '1', name: 'Bakery', path: fixture.root } as HostSite;
	fixture.save( 30, 'page', 'privacy-policy', '', 1, 'draft', 'Privacy Policy' );
	fixture.save( 6, 'page', 'home', '', 1, 'publish', 'Home' );
	fixture.save( 13, 'wp_navigation', 'main', '<!-- wp:page-list /-->', 1, 'publish', 'Main' );
} );

afterEach( () => rmSync( fixture.root, { recursive: true, force: true } ) );

// What the core/navigation block renders by each ref, as get_inner_blocks() in
// wp-includes/blocks/navigation.php reads it, on a site with a classic menu of ID 30.
it.each< { ref: number; renders: string; problem: boolean } >( [
	{ ref: 0, renders: "renders that post's content as the menu", problem: true },
	{ ref: 99, renders: 'the site has no post 99, so it renders no links', problem: true },
	{
		ref: 30,
		renders:
			'post 30 is a page with the status draft, so it renders WordPress\'s fallback menu: the most recently published wp_navigation, else one WordPress creates from a classic menu or a list of the site\'s pages (block_core_navigation_get_fallback_blocks() in wp-includes/blocks/navigation.php). 30 is the ID of the classic menu "Header", a nav_menu term, not a post.',
		problem: true,
	},
	{
		ref: 6,
		renders: 'post 6 is the page "Home", so it renders that page\'s content as the menu',
		problem: true,
	},
	{
		ref: 13,
		renders: 'renders the links of wp_navigation 13 "Main", not the 1 block(s) written inside it',
		problem: false,
	},
] )( 'ref $ref', async ( { ref, renders, problem } ) => {
	sql(
		"INSERT INTO wp_terms VALUES ( 30, 'Header' ); INSERT INTO wp_term_taxonomy VALUES ( 30, 30, 'nav_menu' );"
	);
	const report = await check( () => header( ref ) );
	expect( report?.summary ).toContain(
		`The core/navigation block in wp-content/themes/bakery/parts/header.html has "ref":${ ref }`
	);
	expect( report?.summary ).toContain( renders );
	expect( Boolean( report?.problem ) ).toBe( problem );
} );

it( 'says nothing of a ref to a menu with nothing written inside it, or of no ref', async () => {
	const file = path.join( fixture.root, 'wp-content/themes/bakery/parts/header.html' );
	expect(
		await check( () => {
			mkdirSync( path.dirname( file ), { recursive: true } );
			writeFileSync(
				file,
				'<!-- wp:navigation {"ref":13} /--><!-- wp:navigation --><!-- wp:navigation-link {"label":"Menu","url":"/menu"} /--><!-- /wp:navigation -->'
			);
		} )
	).toBeUndefined();
} );

it( 'resolves the problem once the menu the ref names is published', async () => {
	header( 30 );
	const broken = await navigationRefs.read( site.path, undefined, host );
	fixture.edit( 3, '' );
	const db = await import( 'node:sqlite' );
	const sqlite = new db.DatabaseSync( path.join( fixture.root, 'wp-content/database/.ht.sqlite' ) );
	sqlite.exec(
		"UPDATE wp_posts SET post_type = 'wp_navigation', post_status = 'publish' WHERE ID = 3"
	);
	sqlite.close();
	const after = await navigationRefs.read( site.path, broken, host );
	const { reports } = await navigationRefs.check( site, broken, after, host );
	expect(
		reports.find( ( report ) => report.key.includes( 'parts/header.html' ) )?.problem
	).toBeUndefined();
} );
