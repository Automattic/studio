import { describe, expect, it } from 'vitest';
import {
	describeOpenProblems,
	describeStillInvalid,
	frontPageIsPostsPage,
	OpenProblems,
	postsPageContent,
	withoutNoted,
} from '@studio/agent/node/open-problems';
import { SiteChanges } from '@studio/agent/node/site-changes';
import { createFakeHost } from '@studio/agent/node/tests/fake-host';
import { createSite } from '@studio/agent/node/tests/fixtures/wordpress-site';
import type { HostSite } from '@studio/agent/shared/host';

describe( 'OpenProblems', () => {
	it( 'raises each problem still open once, and the problems of the sites changed', async () => {
		const checked: string[] = [];
		const open = new OpenProblems( [
			async ( site ) => {
				checked.push( site );
				return `${ site } has a problem`;
			},
			async ( site ) => [ `${ site } has a page problem`, `${ site } has another` ],
		] );
		open.record( '/a', '/a/page-1', 'page 1 is invalid' );
		open.record( '/a', '/a/page-2', 'page 2 is invalid' );
		open.record( '/a', '/a/page-2' );

		expect( await open.raise() ).toEqual( [
			'page 1 is invalid',
			'/a has a problem',
			'/a has a page problem',
			'/a has another',
		] );
		expect( checked ).toEqual( [ '/a' ] );
		expect( await open.raise() ).toEqual( [] );

		open.record( '/a', '/a/page-1', 'page 1 is still invalid' );
		expect( await open.raise() ).toEqual( [ 'page 1 is still invalid' ] );
	} );

	it( 'says again at a look the problems open since the last look, once each', () => {
		const open = new OpenProblems( [] );
		open.record( '/a', '/a/page-1', 'page 1 is invalid' );
		// Heard on the result of the call that made it, which this look may share a request with.
		expect( open.look() ).toEqual( [] );
		open.record( '/a', '/a/theme.json', 'theme.json drops a key' );
		expect( open.look() ).toEqual( [ 'page 1 is invalid' ] );
		open.record( '/a', '/a/page-1', 'page 1 is still invalid' );
		expect( open.look() ).toEqual( [ 'theme.json drops a key' ] );
		open.record( '/a', '/a/theme.json' );
		expect( open.look() ).toEqual( [ 'page 1 is still invalid' ] );
		expect( open.look() ).toEqual( [] );
	} );

	it( 'raises only the problems a site did not have when Studio first saw it', async () => {
		const state: Record< string, string[] > = { '/a': [ 'index.html renders no page content' ] };
		const open = new OpenProblems( [ async ( site ) => state[ site ] ] );
		const changes = new SiteChanges(
			createFakeHost(),
			open,
			async () => [ { path: '/a' } as HostSite ],
			[]
		);
		await changes.snapshot();
		state[ '/a' ] = [ ...state[ '/a' ], 'the menu links nowhere' ];
		open.record( '/a', '/a/page-1' );
		// A later call's snapshot leaves what the session's calls did the session's.
		await changes.snapshot();
		state[ '/a' ] = [ ...state[ '/a' ], 'the front page is the posts page' ];
		expect( await open.raise() ).toEqual( [
			'the menu links nowhere',
			'the front page is the posts page',
		] );
	} );

	// eval22 redo port 1: convert_to_blocks saved page 8 to the post, which left its
	// 8 invalid Jetpack fields, raised when the turn ended, invalid.
	it( 'raises a post problem again once a change to the post leaves it open', async () => {
		const problem = 'page 8: 8 block(s) do not match what the block saves';
		let content = 'fields as written';
		const posts = {
			name: 'posts',
			read: async () => ( { 8: content } ),
			check: async (
				_site: HostSite,
				before: Record< string, string >,
				after: Record< string, string >
			) => ( {
				reports: before[ 8 ] === after[ 8 ] ? [] : [ { key: '8', post: 8, problem } ],
			} ),
		};
		const open = new OpenProblems( [] );
		const changes = new SiteChanges(
			createFakeHost(),
			open,
			async () => [ { path: '/a' } as HostSite ],
			[ posts ]
		);
		await changes.snapshot();
		content = 'fields as edited';
		await changes.settle();
		expect( await open.raise() ).toEqual( [ problem ] );
		await changes.settle();
		expect( await open.raise() ).toEqual( [] );
		content = 'fields as converted';
		await changes.settle();
		expect( await open.raise() ).toEqual( [ problem ] );
	} );

	// eval29 redo ports 2 and 3: a marquee's x moving, and one class of a joined
	// note fixed, reopened the turn with what it had raised.
	it.each( [
		{
			name: 'the same item with its numbers changed',
			first: [ 'span "Black Lantern": its text starts at the viewport\'s left edge (x -16).' ],
			then: [ 'span "Black Lantern": its text starts at the viewport\'s left edge (x -24).' ],
			raised: false,
		},
		{
			name: 'one item of the problem fixed',
			first: [ '`.bl-brand` is inline-level.', '`.bl-marquee__track` is inline-level.' ],
			then: [ '`.bl-marquee__track` is inline-level.' ],
			raised: false,
		},
		{
			name: 'an item not raised before',
			first: [ '`.bl-brand` is inline-level.' ],
			then: [ '`.bl-brand` is inline-level.', '`.bl-marquee__track` is inline-level.' ],
			raised: true,
		},
	] )( 'raises a problem again for $name: $raised', async ( { first, then, raised } ) => {
		const open = new OpenProblems( [] );
		open.record( '/a', '/a#rendered pages', first.join( '\n' ), false, first );
		expect( await open.raise() ).toEqual( [ first.join( '\n' ) ] );
		open.record( '/a', '/a#rendered pages', then.join( '\n' ), false, then );
		expect( await open.raise() ).toEqual( raised ? [ then.join( '\n' ) ] : [] );
	} );

	it( 'keeps the problems of different files distinct, whatever their numbers', async () => {
		const open = new OpenProblems( [] );
		open.record( '/a', '/a#8', 'page 8: 8 block(s) do not match what the block saves' );
		expect( await open.raise() ).toHaveLength( 1 );
		open.record( '/a', '/a#9', 'page 9: 3 block(s) do not match what the block saves' );
		expect( await open.raise() ).toEqual( [
			'page 9: 3 block(s) do not match what the block saves',
		] );
	} );

	// eval31 onepage port 1: a footer's site-title and a page's paragraphs, raised
	// as the turn ended and left as they were.
	it( 'says the invalid blocks raised before and left as they were once more, once', async () => {
		const footer = [
			'parts/footer.html: 1 block(s) the editor shows as invalid: each differs:',
			'  - core/site-title: saving it drops its font family.',
			'    written: <p>',
		].join( '\n' );
		const page = [
			'Site page 14 "Home": 3 block(s) the editor shows as invalid: each differs:',
			'  - core/paragraph: saving it drops a class.',
			'  - core/paragraph: saving it drops a class.',
			'  - core/cover: saving it drops a class.',
		].join( '\n' );
		const open = new OpenProblems( [] );
		open.record( '/a', '/a/parts/footer.html', footer );
		open.record( '/a', '/a#14', page );
		open.record( '/a', '/a/theme.json', 'theme.json drops a key' );
		// Raised now, it is said in full now.
		expect( await open.raise() ).toHaveLength( 3 );
		expect( open.remind() ).toEqual( [] );
		expect( await open.raise() ).toEqual( [] );
		expect( open.remind() ).toEqual( [
			'parts/footer.html: core/site-title',
			'Site page 14 "Home": core/paragraph, core/cover',
		] );
		expect( await open.raise() ).toEqual( [] );
		expect( open.remind() ).toEqual( [] );
		// Changed and still invalid, it is raised again, and may be said once more after.
		open.record( '/a', '/a/parts/footer.html', footer, true );
		open.record( '/a', '/a#14' );
		expect( await open.raise() ).toEqual( [ footer ] );
		expect( await open.raise() ).toEqual( [] );
		expect( open.remind() ).toEqual( [ 'parts/footer.html: core/site-title' ] );
	} );

	it( 'says nothing more of invalid blocks fixed since they were raised', async () => {
		const open = new OpenProblems( [] );
		open.record(
			'/a',
			'/a/parts/footer.html',
			'parts/footer.html: 1 invalid block(s), which the block editor cannot fix:\n  - core/site-title: x'
		);
		await open.raise();
		open.record( '/a', '/a/parts/footer.html' );
		expect( await open.raise() ).toEqual( [] );
		expect( open.remind() ).toEqual( [] );
	} );

	it( "tags the invalid blocks said again as Studio's checks", () => {
		expect( describeStillInvalid( [] ) ).toBeUndefined();
		expect( describeStillInvalid( [ 'parts/footer.html: core/site-title' ] ) ).toBe(
			"<studio-checks>\nStudio checked the sites again as the turn ends: these blocks are still invalid on the site, as noted above. The turn is done when each is fixed, or, for one that needs the user's choice, when the user is asked:\n- parts/footer.html: core/site-title\n</studio-checks>"
		);
	} );

	it( 'leaves out a problem the notes of the same message say', () => {
		const note = '`.bl-marquee__track` is a block className and gets an inline-level display.';
		expect(
			withoutNoted(
				[ `Black Lantern: /theme/style.css: ${ note }`, 'page 8 is invalid', note ],
				`Wrote style.css.\n${ note }`
			)
		).toEqual( [ 'page 8 is invalid' ] );
		expect( withoutNoted( [ 'page 8 is invalid' ], undefined ) ).toEqual( [ 'page 8 is invalid' ] );
	} );

	it( "tags the problems as Studio's checks", () => {
		expect( describeOpenProblems( [ 'a', 'b' ] ) ).toBe(
			"<studio-checks>\nStudio checked the sites this turn changed. Each item is how WordPress treats the site as it is now. The turn is done when each is resolved, or, for one that needs the user's choice, when the user is asked:\n- a\n- b\n</studio-checks>"
		);
	} );
} );

describe( 'frontPageIsPostsPage', () => {
	it.each( [
		[ 'the same page', { show_on_front: 'page', page_on_front: '7', page_for_posts: '7' }, true ],
		[
			'another posts page',
			{ show_on_front: 'page', page_on_front: '7', page_for_posts: '8' },
			false,
		],
		[
			'latest posts at the front',
			{ show_on_front: 'posts', page_on_front: '7', page_for_posts: '7' },
			false,
		],
		[ 'no front page', { show_on_front: 'page', page_on_front: '0', page_for_posts: '0' }, false ],
	] )( '%s', async ( _name, options, raised ) => {
		const site = createSite();
		site.save( 7, 'page', 'home', '', 1, 'publish', 'Home' );
		site.setOptions( options );
		const problem = await frontPageIsPostsPage( site.root );
		expect( problem ).toBe(
			raised
				? 'Settings → Reading names page 7 "Home" as both the front page (page_on_front) and the posts page (page_for_posts), which its screen warns against ("these pages should not be the same!", wp-admin/options-reading.php): WordPress then queries the posts index at the front page instead of that page (WP_Query::parse_query in wp-includes/class-wp-query.php). Set page_for_posts to another page, or to 0 for none.'
				: undefined
		);
	} );
} );

describe( 'postsPageContent', () => {
	it.each( [
		[ 'a page with content', { page_for_posts: '6' }, true ],
		[ 'an empty page', { page_for_posts: '8' }, false ],
		[ 'no posts page', { page_for_posts: '0' }, false ],
		[ 'latest posts at the front', { show_on_front: 'posts', page_for_posts: '6' }, false ],
		[ 'the front page, which frontPageIsPostsPage reports', { page_for_posts: '7' }, false ],
	] )( '%s', async ( _name, options, raised ) => {
		const site = createSite();
		site.save(
			6,
			'page',
			'classes',
			'<!-- wp:paragraph --><p>Yoga</p><!-- /wp:paragraph -->',
			1,
			'publish',
			'Classes'
		);
		site.save( 7, 'page', 'home', 'Welcome', 1, 'publish', 'Home' );
		site.save( 8, 'page', 'journal', ' \n', 1, 'publish', 'Journal' );
		site.setOptions( { show_on_front: 'page', page_on_front: '7', ...options } );
		expect( await postsPageContent( site.root ) ).toBe(
			raised
				? 'Settings → Reading names page 6 "Classes", which has content, as the posts page (page_for_posts): WordPress queries the posts index at that page, so its content shows nowhere (WP_Query::parse_query in wp-includes/class-wp-query.php), and the editor shows "You are currently editing the page that shows your latest posts." (wp-admin/edit-form-advanced.php). Set page_for_posts to an empty page for the posts index, or to 0 for none.'
				: undefined
		);
	} );
} );
