import { beforeEach, describe, expect, it, vi } from 'vitest';
import { wpcomClient } from '../../api';
import { fetchLiveChangesSince } from '../api';

vi.mock( '../../api' );

const get = vi.fn();

// Answers the posts endpoint by post type, and the comments endpoint with `comments`.
function answers( {
	posts = { found: 0, posts: [] },
	templates = { found: 0, posts: [] },
	templateParts = { found: 0, posts: [] },
	comments = { found: 0, comments: [] },
}: Record< string, unknown > ) {
	get.mockImplementation( async ( path: string, query: { type?: string } ) => {
		if ( path.endsWith( '/comments' ) ) {
			return comments;
		}
		const byType: Record< string, unknown > = {
			any: posts,
			wp_template: templates,
			wp_template_part: templateParts,
		};
		const answer = byType[ query.type ?? '' ];
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
	it( 'asks for posts, templates and template parts modified, and comments made, after the time', async () => {
		answers( {} );

		await fetchLiveChangesSince( 'token', 42, '2026-11-01T00:00:00.000Z' );

		for ( const type of [ 'any', 'wp_template', 'wp_template_part' ] ) {
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

	it( 'adds templates and template parts together', async () => {
		answers( {
			posts: { found: 86, posts: [ { ID: 1 } ] },
			templates: { found: 2, posts: [ { ID: 2 }, { ID: 3 } ] },
			templateParts: { found: 5, posts: [ { ID: 4 } ] },
		} );

		await expect(
			fetchLiveChangesSince( 'token', 42, '2000-01-01T00:00:00.000Z' )
		).resolves.toEqual( { posts: 86, comments: 0, templates: 7 } );
	} );

	it( 'counts what came back when WordPress.com reports no total', async () => {
		answers( { comments: { found: -1, comments: [ { ID: 1 }, { ID: 2 } ] } } );

		await expect(
			fetchLiveChangesSince( 'token', 42, '2000-01-01T00:00:00.000Z' )
		).resolves.toEqual( { posts: 0, comments: 2, templates: 0 } );
	} );

	it( 'counts nothing when no total and no items came back', async () => {
		answers( { comments: { found: -1, site_ID: 42, comments: [] } } );

		await expect(
			fetchLiveChangesSince( 'token', 42, '2026-11-17T00:00:00.000Z' )
		).resolves.toEqual( { posts: 0, comments: 0, templates: 0 } );
	} );

	it( 'counts no templates on a site that does not register them', async () => {
		const unknownPostType = Object.assign( new Error( 'Unknown post type' ), {
			statusCode: 400,
			error: 'unknown_post_type',
		} );
		answers( { templates: unknownPostType, templateParts: unknownPostType } );

		await expect(
			fetchLiveChangesSince( 'token', 42, '2026-11-17T00:00:00.000Z' )
		).resolves.toEqual( { posts: 0, comments: 0, templates: 0 } );
	} );

	it( 'fails the check when a template request fails otherwise', async () => {
		answers( {
			templates: Object.assign( new Error( 'Forbidden' ), { statusCode: 403, error: 'forbidden' } ),
		} );

		await expect(
			fetchLiveChangesSince( 'token', 42, '2026-11-17T00:00:00.000Z' )
		).rejects.toThrow( 'Forbidden' );
	} );
} );
