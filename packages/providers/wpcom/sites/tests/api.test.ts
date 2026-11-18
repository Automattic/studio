import { beforeEach, describe, expect, it, vi } from 'vitest';
import { wpcomClient } from '../../api';
import { fetchLiveChangesSince } from '../api';

vi.mock( '../../api' );

const get = vi.fn();

beforeEach( () => {
	vi.resetAllMocks();
	vi.mocked( wpcomClient ).mockReturnValue( { req: { get } } as never );
} );

describe( 'fetchLiveChangesSince', () => {
	it( 'asks for posts modified and comments made after the time', async () => {
		get.mockResolvedValue( { found: 0, posts: [], comments: [] } );

		await fetchLiveChangesSince( 'token', 42, '2026-11-01T00:00:00.000Z' );

		expect( get ).toHaveBeenCalledWith(
			'/sites/42/posts',
			expect.objectContaining( {
				type: 'any',
				status: 'publish,private,draft,pending,future,trash',
				modified_after: '2026-11-01T00:00:00.000Z',
			} )
		);
		expect( get ).toHaveBeenCalledWith(
			'/sites/42/comments',
			expect.objectContaining( { status: 'all', after: '2026-11-01T00:00:00.000Z' } )
		);
	} );

	it( 'counts what came back when WordPress.com reports no total', async () => {
		get.mockImplementation( async ( path: string ) =>
			path.endsWith( '/posts' )
				? { found: 86, posts: [ { ID: 1 } ] }
				: { found: -1, comments: [ { ID: 1 }, { ID: 2 } ] }
		);

		await expect(
			fetchLiveChangesSince( 'token', 42, '2000-01-01T00:00:00.000Z' )
		).resolves.toEqual( { posts: 86, comments: 2 } );
	} );

	it( 'counts nothing when no total and no items came back', async () => {
		get.mockResolvedValue( { found: -1, site_ID: 42, comments: [] } );

		await expect(
			fetchLiveChangesSince( 'token', 42, '2026-11-17T00:00:00.000Z' )
		).resolves.toEqual( { posts: 0, comments: 0 } );
	} );
} );
