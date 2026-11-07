import { rmSync } from 'fs';
import { DatabaseSync } from 'node:sqlite';
import path from 'path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { renamedSlugs } from '@studio/agent/node/renamed-slugs';
import { createFakeHost } from '@studio/agent/node/tests/fake-host';
import { createSite } from '@studio/agent/node/tests/fixtures/wordpress-site';
import type { HostSite } from '@studio/agent/node/host';

let fixture: ReturnType< typeof createSite >;
let site: HostSite;
const host = createFakeHost();

const check = async ( write: () => void ) => {
	const before = await renamedSlugs.read( site.path, undefined, host );
	write();
	const after = await renamedSlugs.read( site.path, before, host );
	return ( await renamedSlugs.check( site, before, after, host ) ).reports;
};

beforeEach( () => {
	fixture = createSite();
	site = { id: '1', name: 'Dental', path: fixture.root } as HostSite;
	fixture.save( 19, 'page', 'contact', '', 1, 'publish', 'Contact' );
	fixture.save( 7, 'attachment', 'about', '', 1, 'inherit', 'about' );
	fixture.save( 8, 'post', 'news', '', 1, 'publish', 'News' );
} );

afterEach( () => rmSync( fixture.root, { recursive: true, force: true } ) );

// The slugs wp_unique_post_slug() numbers: a page's among its siblings and
// their attachments, a post's among posts.
it.each< { name: string; type: string; slug: string; parent?: number; taken?: string } >( [
	{
		name: 'a page created twice',
		type: 'page',
		slug: 'contact-2',
		taken: 'page 19 "Contact" has contact',
	},
	{
		name: 'a page named after an image',
		type: 'page',
		slug: 'about-2',
		taken: 'attachment 7 "about" has about',
	},
	{
		name: 'a post named after a post',
		type: 'post',
		slug: 'news-2',
		taken: 'post 8 "News" has news',
	},
	{ name: 'a post named after a page', type: 'post', slug: 'contact-2' },
	{ name: 'a child page', type: 'page', slug: 'contact-2', parent: 19 },
	{ name: 'a page numbered with no page of its name', type: 'page', slug: 'team-2' },
] )( '$name', async ( { type, slug, parent = 0, taken } ) => {
	const reports = await check( () =>
		fixture.save( 20, type, slug, '', 1, 'publish', 'New', parent )
	);
	expect( reports.map( ( report ) => report.problem ) ).toEqual(
		taken
			? [ expect.stringContaining( `has the slug ${ slug }, not ${ slug.slice( 0, -2 ) }` ) ]
			: []
	);
	if ( taken ) {
		expect( reports[ 0 ].problem ).toContain( taken );
	}
} );

it( 'resolves once the duplicate is deleted', async () => {
	await check( () => fixture.save( 20, 'page', 'contact-2', '', 1, 'publish', 'Contact' ) );
	const resolved = await check( () => {
		const db = new DatabaseSync( path.join( fixture.root, 'wp-content/database/.ht.sqlite' ) );
		db.exec( 'DELETE FROM wp_posts WHERE ID = 20' );
		db.close();
	} );
	expect( resolved ).toEqual( [ { key: 'slug 20', post: '20' } ] );
} );

it( "leaves a numbered slug the site already had to the user's site", async () => {
	fixture.save( 20, 'page', 'contact-2', '', 1, 'publish', 'Contact' );
	const reports = await check( () => fixture.save( 21, 'page', 'team', '', 1, 'publish', 'Team' ) );
	expect( reports ).toEqual( [] );
} );
