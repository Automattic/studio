import { beforeEach, describe, expect, it, vi } from 'vitest';
import { wpcomClient } from '../../api';
import { fetchLiveChangesSince } from '../api';

vi.mock( '../../api' );

const get = vi.fn();

// Answers the posts endpoint by post type (`posts` for `any`, otherwise the type's own key), and
// the comments endpoint with `comments`.
function answers( {
	posts = { found: 0, posts: [] },
	comments = { found: 0, comments: [] },
	...siteDesign
}: Record< string, unknown > ) {
	get.mockImplementation( async ( path: string, query: { type?: string } ) => {
		if ( path.endsWith( '/comments' ) ) {
			return comments;
		}
		const answer =
			query.type === 'any' ? posts : siteDesign[ query.type ?? '' ] ?? { found: 0, posts: [] };
		if ( answer instanceof Error ) {
			throw answer;
		}
		return answer;
	} );
}

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
			expect.objectContaining( { status: 'all', after: '2026-11-01T00:00:00.000Z' } )
		);
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

	it( 'fails the check when a site design request fails otherwise', async () => {
		answers( {
			wp_template: Object.assign( new Error( 'Forbidden' ), {
				statusCode: 403,
				error: 'forbidden',
			} ),
		} );

		await expect(
			fetchLiveChangesSince( 'token', 42, '2026-11-17T00:00:00.000Z' )
		).rejects.toThrow( 'Forbidden' );
	} );
} );
