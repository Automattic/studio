import { beforeEach, describe, expect, it, vi } from 'vitest';
import { wpcomClient } from '../../api';
import { fetchLiveChangesSince } from '../api';

vi.mock( '../../api' );

const get = vi.fn();

// Answers the site with its UTC offset and time zone, the posts endpoint by post type (`posts`
// for `any`, otherwise the type's own key), and the media and comments endpoints. An answer that is an error is thrown.
function answers( {
	gmtOffset = 0,
	timezone = '',
	site = { ID: 42, options: { gmt_offset: gmtOffset, timezone } },
	posts = { found: 0, posts: [] },
	media = { found: 0, media: [] },
	comments = { found: 0, comments: [] },
	...siteDesign
}: Record< string, unknown > ) {
	get.mockImplementation( async ( path: string, query: { type?: string } ) => {
		const answer =
			path === '/sites/42'
				? site
				: path.endsWith( '/media' )
				? media
				: path.endsWith( '/comments' )
				? comments
				: query.type === 'any'
				? posts
				: siteDesign[ query.type ?? '' ] ?? { found: 0, posts: [] };
		if ( answer instanceof Error ) {
			throw answer;
		}
		return answer;
	} );
}

const forbidden = () =>
	Object.assign( new Error( 'Forbidden' ), { statusCode: 403, error: 'forbidden' } );

beforeEach( () => {
	vi.resetAllMocks();
	vi.mocked( wpcomClient ).mockReturnValue( { req: { get } } as never );
} );

describe( 'fetchLiveChangesSince', () => {
	it( 'asks for posts and the site design modified, and comments made, after the time', async () => {
		answers( {} );

		await fetchLiveChangesSince( 'token', 42, '2026-11-01T00:00:00.000Z' );

		for ( const type of [
			'any',
			'wp_template',
			'wp_template_part',
			'wp_navigation',
			'wp_block',
			'wp_global_styles',
		] ) {
			expect( get ).toHaveBeenCalledWith(
				'/sites/42/posts',
				expect.objectContaining( {
					type,
					status: 'publish,private,draft,pending,future,trash',
					modified_after: '2026-11-01T00:00:00.000Z',
				} )
			);
		}
		expect( get ).toHaveBeenCalledWith(
			'/sites/42/comments',
			expect.objectContaining( { status: 'all', after: '2026-11-01T00:00:00+00:00' } )
		);
		expect( get ).toHaveBeenCalledWith(
			'/sites/42/media',
			expect.objectContaining( { after: '2026-11-01T00:00:00+00:00' } )
		);
	} );

	it( 'asks for comments and media in the site’s local time, which those endpoints compare with', async () => {
		answers( { gmtOffset: -3 } );

		await fetchLiveChangesSince( 'token', 42, '2026-11-17T14:13:33.613Z' );

		expect( get ).toHaveBeenCalledWith(
			'/sites/42/posts',
			expect.objectContaining( { type: 'any', modified_after: '2026-11-17T14:13:33.613Z' } )
		);
		expect( get ).toHaveBeenCalledWith(
			'/sites/42/comments',
			expect.objectContaining( { after: '2026-11-17T11:13:33-03:00' } )
		);
		expect( get ).toHaveBeenCalledWith(
			'/sites/42/media',
			expect.objectContaining( { after: '2026-11-17T11:13:33-03:00' } )
		);
	} );

	it.each( [
		// Synced before the clocks went forward: the offset then, not today's.
		[ 'America/New_York', -4, '2026-03-08T06:30:00.000Z', '2026-03-08T01:30:00-05:00' ],
		// Synced just before the clocks went back, when the next hour's local times come round again.
		[ 'America/New_York', -5, '2026-11-01T05:45:00.000Z', '2026-11-01T00:45:00-05:00' ],
		[ 'America/Fortaleza', -3, '2026-11-17T14:13:33.613Z', '2026-11-17T11:13:33-03:00' ],
		[ 'Asia/Kolkata', 5.5, '2026-11-17T14:13:33.613Z', '2026-11-17T19:43:33+05:30' ],
		// A zone the runtime doesn't know falls back to the site's offset.
		[ 'Not/A_Zone', 2, '2026-11-17T14:13:33.613Z', '2026-11-17T16:13:33+02:00' ],
	] )(
		'asks a site in %s for comments with the offset it had at the time',
		async ( timezone, gmtOffset, since, expected ) => {
			answers( { timezone, gmtOffset } );

			await fetchLiveChangesSince( 'token', 42, since );

			expect( get ).toHaveBeenCalledWith(
				'/sites/42/comments',
				expect.objectContaining( { after: expected } )
			);
		}
	);

	it( 'counts media uploaded live as content', async () => {
		answers( {
			posts: { found: 2, posts: [] },
			media: { found: 3, media: [] },
		} );

		await expect(
			fetchLiveChangesSince( 'token', 42, '2026-11-17T00:00:00.000Z' )
		).resolves.toEqual( { posts: 5, comments: 0, siteDesign: 0 } );
	} );

	it( 'adds up every part of the site design', async () => {
		answers( {
			posts: { found: 86, posts: [ { ID: 1 } ] },
			wp_template: { found: 2, posts: [ { ID: 2 }, { ID: 3 } ] },
			wp_template_part: { found: 5, posts: [ { ID: 4 } ] },
			wp_navigation: { found: 2, posts: [] },
			wp_block: { found: 0, posts: [] },
			wp_global_styles: { found: -1, posts: [ { ID: 5 } ] },
		} );

		await expect(
			fetchLiveChangesSince( 'token', 42, '2000-01-01T00:00:00.000Z' )
		).resolves.toEqual( { posts: 86, comments: 0, siteDesign: 10 } );
	} );

	it( 'counts what came back when WordPress.com reports no total', async () => {
		answers( { comments: { found: -1, comments: [ { ID: 1 }, { ID: 2 } ] } } );

		await expect(
			fetchLiveChangesSince( 'token', 42, '2000-01-01T00:00:00.000Z' )
		).resolves.toEqual( { posts: 0, comments: 2, siteDesign: 0 } );
	} );

	it( 'counts nothing when no total and no items came back', async () => {
		answers( { comments: { found: -1, site_ID: 42, comments: [] } } );

		await expect(
			fetchLiveChangesSince( 'token', 42, '2026-11-17T00:00:00.000Z' )
		).resolves.toEqual( { posts: 0, comments: 0, siteDesign: 0 } );
	} );

	it( 'counts nothing for a type the site does not register', async () => {
		const unknownPostType = Object.assign( new Error( 'Unknown post type' ), {
			statusCode: 400,
			error: 'unknown_post_type',
		} );
		answers( { wp_navigation: unknownPostType, wp_global_styles: unknownPostType } );

		await expect(
			fetchLiveChangesSince( 'token', 42, '2026-11-17T00:00:00.000Z' )
		).resolves.toEqual( { posts: 0, comments: 0, siteDesign: 0 } );
	} );

	it( 'fails the check when a request fails and the others found nothing', async () => {
		answers( { wp_template: forbidden() } );

		await expect(
			fetchLiveChangesSince( 'token', 42, '2026-11-17T00:00:00.000Z' )
		).rejects.toThrow( 'Forbidden' );
	} );

	it( 'keeps the changes found when another request fails', async () => {
		answers( { posts: { found: 2, posts: [] }, wp_template: forbidden() } );

		await expect(
			fetchLiveChangesSince( 'token', 42, '2026-11-17T00:00:00.000Z' )
		).resolves.toEqual( { posts: 2, comments: 0, siteDesign: 0 } );
	} );

	it( 'still counts posts and design when the site’s time zone can’t be read', async () => {
		answers( { site: forbidden(), wp_block: { found: 1, posts: [] } } );

		await expect(
			fetchLiveChangesSince( 'token', 42, '2026-11-17T00:00:00.000Z' )
		).resolves.toEqual( { posts: 0, comments: 0, siteDesign: 1 } );
	} );
} );
