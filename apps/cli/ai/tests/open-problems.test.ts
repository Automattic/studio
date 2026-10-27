import { describe, expect, it } from 'vitest';
import {
	describeOpenProblems,
	frontPageIsPostsPage,
	OpenProblems,
	postsPageContent,
} from 'cli/ai/open-problems';
import { SiteChanges } from 'cli/ai/site-changes';
import { createSite } from 'cli/ai/tests/fixtures/wordpress-site';
import type { SiteData } from 'cli/lib/cli-config/core';

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

	it( 'raises only the problems a site did not have when Studio first saw it', async () => {
		const state: Record< string, string[] > = { '/a': [ 'index.html renders no page content' ] };
		const open = new OpenProblems( [ async ( site ) => state[ site ] ] );
		const changes = new SiteChanges( open, async () => [ { path: '/a' } as SiteData ], [] );
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

	it( "asks each question a changed site's state asks once, unless the site already asked it", async () => {
		const state: Record< string, string[] > = { '/a': [ 'kept' ], '/b': [] };
		const asked: string[] = [];
		const open = new OpenProblems(
			[],
			[
				async ( site ) => {
					const [ key ] = state[ site ].slice( -1 );
					return key
						? {
								key: `${ site } ${ key }`,
								prepare: async () => ( {
									question: { question: `${ site } ${ key }?`, options: [] },
									answered: async ( answer ) =>
										answer === 'Nothing' ? undefined : `told ${ answer }`,
								} ),
						  }
						: undefined;
				},
			]
		);
		const changes = new SiteChanges(
			open,
			async () => [ { path: '/a' } as SiteData, { path: '/b' } as SiteData ],
			[]
		);
		await changes.snapshot();
		open.record( '/a', '/a/page' );
		open.record( '/b', '/b/page' );
		const answers: Record< string, string | undefined > = {
			'/a kept?': 'Red',
			'/a new?': 'Blue',
			'/b new?': 'Nothing',
		};
		const onAskUser = async ( [ { question } ]: Array< { question: string } > ) => {
			asked.push( question );
			const answer = answers[ question ];
			return answer ? { [ question ]: answer } : {};
		};
		expect( await open.ask( onAskUser ) ).toEqual( [] );
		expect( asked ).toEqual( [] );

		state[ '/a' ] = [ 'kept', 'new' ];
		state[ '/b' ] = [ 'new' ];
		expect( await open.ask( onAskUser ) ).toEqual( [ 'told Blue' ] );
		expect( asked ).toEqual( [ '/a new?', '/b new?' ] );
		expect( await open.ask( onAskUser ) ).toEqual( [] );
		expect( asked ).toHaveLength( 2 );
	} );

	it( "tags the problems as Studio's checks", () => {
		expect( describeOpenProblems( [ 'a', 'b' ] ) ).toBe(
			"<studio-checks>\nStudio checked the sites this turn changed. Each item is how WordPress treats the site as it is now, from WordPress's source. The turn is done when each is resolved, or, for one that needs the user's choice, when the user is asked:\n- a\n- b\n</studio-checks>"
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
