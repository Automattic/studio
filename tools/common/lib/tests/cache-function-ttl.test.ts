import { vi } from 'vitest';
import { cacheFunctionTTL, clearCache } from '@studio/common/lib/cache-function-ttl';

describe( 'cacheFunctionTTL', () => {
	beforeEach( () => {
		vi.useFakeTimers();
	} );

	afterEach( () => {
		vi.runOnlyPendingTimers();
	} );

	it( 'should return different results for different arguments', async () => {
		const fetchUser = vi.fn( async ( userId: number ) => {
			return { id: userId, name: `User ${ userId }` };
		} );

		const cachedFetchUser = cacheFunctionTTL( fetchUser, 1000 );

		const user1 = await cachedFetchUser( 1 );
		const user2 = await cachedFetchUser( 2 );

		expect( user1 ).toEqual( { id: 1, name: 'User 1' } );
		expect( user2 ).toEqual( { id: 2, name: 'User 2' } );
		expect( fetchUser ).toHaveBeenCalledTimes( 2 );
	} );

	it( 'should cache results for the same arguments within TTL', async () => {
		const fetchUser = vi.fn( async ( userId: number ) => {
			return { id: userId, name: `User ${ userId }` };
		} );

		const cachedFetchUser = cacheFunctionTTL( fetchUser, 1000 );

		const user1First = await cachedFetchUser( 1 );
		const user1Second = await cachedFetchUser( 1 );

		expect( fetchUser ).toHaveBeenCalledTimes( 1 );
		expect( user1First ).toEqual( user1Second );
	} );

	it( 'should expire cache after TTL', async () => {
		const fetchUser = vi.fn( async ( userId: number ) => {
			return { id: userId, name: `User ${ userId }` };
		} );

		const cachedFetchUser = cacheFunctionTTL( fetchUser, 1000 );

		const user1First = await cachedFetchUser( 1 );
		expect( fetchUser ).toHaveBeenCalledTimes( 1 );

		vi.advanceTimersByTime( 1000 );

		const user1Second = await cachedFetchUser( 1 );
		expect( fetchUser ).toHaveBeenCalledTimes( 2 );
		expect( user1First ).toEqual( user1Second );
	} );

	it( 'should not expire cache before TTL expires', async () => {
		const fetchUser = vi.fn( async ( userId: number ) => {
			return { id: userId, name: `User ${ userId }` };
		} );

		const cachedFetchUser = cacheFunctionTTL( fetchUser, 1000 );

		await cachedFetchUser( 1 );
		vi.advanceTimersByTime( 500 );
		await cachedFetchUser( 1 );

		expect( fetchUser ).toHaveBeenCalledTimes( 1 );
	} );

	it( 'should handle multiple arguments correctly', async () => {
		const getUserPosts = vi.fn( async ( userId: number, postId: number ) => {
			return { userId, postId, title: `Post ${ postId } by User ${ userId }` };
		} );

		const cachedGetUserPosts = cacheFunctionTTL( getUserPosts, 1000 );

		const post1User1 = await cachedGetUserPosts( 1, 1 );
		const post2User1 = await cachedGetUserPosts( 1, 2 );
		const post1User2 = await cachedGetUserPosts( 2, 1 );

		expect( getUserPosts ).toHaveBeenCalledTimes( 3 );
		expect( post1User1 ).toEqual( { userId: 1, postId: 1, title: 'Post 1 by User 1' } );
		expect( post2User1 ).toEqual( { userId: 1, postId: 2, title: 'Post 2 by User 1' } );
		expect( post1User2 ).toEqual( { userId: 2, postId: 1, title: 'Post 1 by User 2' } );
	} );

	it( 'should handle object arguments with deep equality', async () => {
		const fetchUser = vi.fn( async ( filter: { id: number; active: boolean } ) => {
			return { ...filter, name: `User ${ filter.id }` };
		} );

		const cachedFetchUser = cacheFunctionTTL( fetchUser, 1000 );

		const user1 = await cachedFetchUser( { id: 1, active: true } );
		const user2 = await cachedFetchUser( { id: 1, active: true } );

		expect( fetchUser ).toHaveBeenCalledTimes( 1 );
		expect( user1 ).toEqual( user2 );
	} );

	it( 'should distinguish between different object arguments', async () => {
		const fetchUser = vi.fn( async ( filter: { id: number; active: boolean } ) => {
			return filter;
		} );

		const cachedFetchUser = cacheFunctionTTL( fetchUser, 1000 );

		const result1 = await cachedFetchUser( { id: 1, active: true } );
		const result2 = await cachedFetchUser( { id: 1, active: false } );

		expect( result1 ).toEqual( { id: 1, active: true } );
		expect( result2 ).toEqual( { id: 1, active: false } );
		expect( fetchUser ).toHaveBeenCalledTimes( 2 );
	} );

	it( 'should handle no arguments', async () => {
		const getData = vi.fn( async () => {
			return { data: 'test' };
		} );

		const cachedGetData = cacheFunctionTTL( getData, 1000 );

		const result1 = await cachedGetData();
		const result2 = await cachedGetData();

		expect( getData ).toHaveBeenCalledTimes( 1 );
		expect( result1 ).toEqual( result2 );
	} );

	it( 'should share cache when wrapping the same function', async () => {
		const fetchUser = vi.fn( async ( userId: number ) => {
			return { id: userId, name: `User ${ userId }` };
		} );

		const cachedFetchUser1 = cacheFunctionTTL( fetchUser, 1000 );
		const cachedFetchUser2 = cacheFunctionTTL( fetchUser, 1000 );

		await cachedFetchUser1( 1 );
		await cachedFetchUser2( 1 );

		// Both wrappers share the same cache since they wrap the same function
		expect( fetchUser ).toHaveBeenCalledTimes( 1 );
	} );

	it( 'should maintain separate caches for different function instances', async () => {
		const fetchUser = vi.fn( async ( userId: number ) => {
			return { id: userId, name: `User ${ userId }` };
		} );

		const fetchPost = vi.fn( async ( postId: number ) => {
			return { id: postId, title: `Post ${ postId }` };
		} );

		const cachedFetchUser = cacheFunctionTTL( fetchUser, 1000 );
		const cachedFetchPost = cacheFunctionTTL( fetchPost, 1000 );

		await cachedFetchUser( 1 );
		await cachedFetchPost( 1 );
		await cachedFetchUser( 1 );
		await cachedFetchPost( 1 );

		expect( fetchUser ).toHaveBeenCalledTimes( 1 );
		expect( fetchPost ).toHaveBeenCalledTimes( 1 );
	} );

	it( 'should handle rejected promises', async () => {
		const fetchUser = vi.fn( async ( userId: number ) => {
			if ( userId === 0 ) {
				throw new Error( 'Invalid user ID' );
			}
			return { id: userId, name: `User ${ userId }` };
		} );

		const cachedFetchUser = cacheFunctionTTL( fetchUser, 1000 );

		await expect( cachedFetchUser( 0 ) ).rejects.toThrow( 'Invalid user ID' );
		expect( fetchUser ).toHaveBeenCalledTimes( 1 );
	} );

	it( 'should handle null and undefined values', async () => {
		const fetchUser = vi.fn( async ( userId: number | null ) => {
			if ( userId === null ) {
				return null;
			}
			return { id: userId, name: `User ${ userId }` };
		} );

		const cachedFetchUser = cacheFunctionTTL( fetchUser, 1000 );

		const nullResult1 = await cachedFetchUser( null );
		const nullResult2 = await cachedFetchUser( null );

		expect( fetchUser ).toHaveBeenCalledTimes( 1 );
		expect( nullResult1 ).toBeNull();
		expect( nullResult2 ).toBeNull();
	} );

	it( 'should use default TTL of 1 second when not specified', async () => {
		const fetchUser = vi.fn( async ( userId: number ) => {
			return { id: userId, name: `User ${ userId }` };
		} );

		const cachedFetchUser = cacheFunctionTTL( fetchUser );

		await cachedFetchUser( 1 );
		expect( fetchUser ).toHaveBeenCalledTimes( 1 );

		vi.advanceTimersByTime( 999 );
		await cachedFetchUser( 1 );
		expect( fetchUser ).toHaveBeenCalledTimes( 1 );

		vi.advanceTimersByTime( 1 );
		await cachedFetchUser( 1 );
		expect( fetchUser ).toHaveBeenCalledTimes( 2 );
	} );

	it( 'should handle mixed cache hits and misses', async () => {
		const fetchUser = vi.fn( async ( userId: number ) => {
			return { id: userId, name: `User ${ userId }` };
		} );

		const cachedFetchUser = cacheFunctionTTL( fetchUser, 1000 );

		await cachedFetchUser( 1 );
		await cachedFetchUser( 1 );
		await cachedFetchUser( 2 );
		await cachedFetchUser( 1 );
		await cachedFetchUser( 2 );
		await cachedFetchUser( 3 );

		expect( fetchUser ).toHaveBeenCalledTimes( 3 );
	} );

	it( 'should maintain separate caches for different argument combinations after TTL expiration', async () => {
		const fetchUser = vi.fn( async ( userId: number ) => {
			return { id: userId, name: `User ${ userId }` };
		} );

		const cachedFetchUser = cacheFunctionTTL( fetchUser, 1000 );

		await cachedFetchUser( 1 );
		await cachedFetchUser( 2 );

		vi.advanceTimersByTime( 1000 );

		await cachedFetchUser( 1 );
		await cachedFetchUser( 2 );

		expect( fetchUser ).toHaveBeenCalledTimes( 4 );
	} );

	it( 'should handle array arguments correctly', async () => {
		const fetchMultiple = vi.fn( async ( ids: number[] ) => {
			return ids.map( ( id ) => ( { id, name: `User ${ id }` } ) );
		} );

		const cachedFetchMultiple = cacheFunctionTTL( fetchMultiple, 1000 );

		const result1 = await cachedFetchMultiple( [ 1, 2, 3 ] );
		const result2 = await cachedFetchMultiple( [ 1, 2, 3 ] );

		expect( fetchMultiple ).toHaveBeenCalledTimes( 1 );
		expect( result1 ).toEqual( result2 );
	} );

	it( 'should distinguish between array arguments with different elements', async () => {
		const fetchMultiple = vi.fn( async ( ids: number[] ) => {
			return ids.map( ( id ) => ( { id } ) );
		} );

		const cachedFetchMultiple = cacheFunctionTTL( fetchMultiple, 1000 );

		const result1 = await cachedFetchMultiple( [ 1, 2, 3 ] );
		const result2 = await cachedFetchMultiple( [ 1, 2 ] );

		expect( fetchMultiple ).toHaveBeenCalledTimes( 2 );
		expect( result1 ).toHaveLength( 3 );
		expect( result2 ).toHaveLength( 2 );
	} );

	it( 'should handle boolean arguments', async () => {
		const fetchData = vi.fn( async ( enabled: boolean ) => ( { enabled } ) );
		const cachedFetch = cacheFunctionTTL( fetchData, 1000 );

		const result1 = await cachedFetch( true );
		const result2 = await cachedFetch( true );
		const result3 = await cachedFetch( false );

		expect( result1 ).toEqual( { enabled: true } );
		expect( result2 ).toEqual( { enabled: true } );
		expect( result3 ).toEqual( { enabled: false } );
		expect( fetchData ).toHaveBeenCalledTimes( 2 );
	} );

	it( 'should handle string arguments', async () => {
		const fetchData = vi.fn( async ( query: string ) => ( { query, length: query.length } ) );
		const cachedFetch = cacheFunctionTTL( fetchData, 1000 );

		const result1 = await cachedFetch( 'hello' );
		const result2 = await cachedFetch( 'hello' );
		const result3 = await cachedFetch( 'world' );

		expect( result1 ).toEqual( { query: 'hello', length: 5 } );
		expect( result2 ).toEqual( { query: 'hello', length: 5 } );
		expect( result3 ).toEqual( { query: 'world', length: 5 } );
		expect( fetchData ).toHaveBeenCalledTimes( 2 );
	} );

	it( 'should expire individual cached entries independently', async () => {
		const fetchData = vi.fn( async ( id: number ) => ( { id } ) );
		const cachedFetch = cacheFunctionTTL( fetchData, 1000 );

		await cachedFetch( 1 );
		await cachedFetch( 2 );
		expect( fetchData ).toHaveBeenCalledTimes( 2 );

		vi.advanceTimersByTime( 1000 );

		await cachedFetch( 1 );
		await cachedFetch( 2 );
		expect( fetchData ).toHaveBeenCalledTimes( 4 );
	} );

	it( 'should handle rapid successive calls with same arguments', async () => {
		const fetchData = vi.fn( async () => ( { value: 'cached-result' } ) );
		const cachedFetch = cacheFunctionTTL( fetchData, 1000 );

		const result1 = await cachedFetch();
		const result2 = await cachedFetch();
		const result3 = await cachedFetch();

		expect( result1 ).toEqual( result2 );
		expect( result2 ).toEqual( result3 );
		expect( fetchData ).toHaveBeenCalledTimes( 1 );
	} );

	it( 'should preserve cached value across multiple TTL windows', async () => {
		const fetchData = vi.fn( async () => ( { value: 'constant' } ) );
		const cachedFetch = cacheFunctionTTL( fetchData, 1000 );

		const result1 = await cachedFetch();
		expect( fetchData ).toHaveBeenCalledTimes( 1 );

		vi.advanceTimersByTime( 500 );
		const result2 = await cachedFetch();
		expect( fetchData ).toHaveBeenCalledTimes( 1 );

		vi.advanceTimersByTime( 400 );
		const result3 = await cachedFetch();
		expect( fetchData ).toHaveBeenCalledTimes( 1 );

		expect( result1 ).toEqual( result2 );
		expect( result2 ).toEqual( result3 );
	} );

	it( 'should handle complex nested object arguments', async () => {
		const fetchData = vi.fn(
			async ( config: { user: { id: number; name: string }; settings: { enabled: boolean } } ) => {
				return config;
			}
		);

		const cachedFetch = cacheFunctionTTL( fetchData, 1000 );

		const config = { user: { id: 1, name: 'John' }, settings: { enabled: true } };
		const result1 = await cachedFetch( config );
		const result2 = await cachedFetch( {
			user: { id: 1, name: 'John' },
			settings: { enabled: true },
		} );

		expect( result1 ).toEqual( result2 );
		expect( fetchData ).toHaveBeenCalledTimes( 1 );
	} );

	it( 'should clear all cache entries when clearCache is called', async () => {
		const fetchData = vi.fn( async () => ( { value: 'test' } ) );
		const cachedFetch = cacheFunctionTTL( fetchData, 1000 );

		const result1 = await cachedFetch();
		expect( fetchData ).toHaveBeenCalledTimes( 1 );

		const result2 = await cachedFetch();
		expect( fetchData ).toHaveBeenCalledTimes( 1 );
		expect( result1 ).toEqual( result2 );

		clearCache();

		const result3 = await cachedFetch();
		expect( fetchData ).toHaveBeenCalledTimes( 2 );
		expect( result1 ).toEqual( result3 );
	} );

	it( 'should allow cache to repopulate after clearing', async () => {
		const fetchData = vi.fn( async ( id: number ) => ( { id, value: `data-${ id }` } ) );
		const cachedFetch = cacheFunctionTTL( fetchData, 1000 );

		await cachedFetch( 1 );
		await cachedFetch( 1 );
		expect( fetchData ).toHaveBeenCalledTimes( 1 );

		clearCache();

		await cachedFetch( 1 );
		await cachedFetch( 1 );
		expect( fetchData ).toHaveBeenCalledTimes( 2 );
	} );

	it( 'should clear cache for multiple cached arguments', async () => {
		const fetchData = vi.fn( async ( id: number ) => ( { id } ) );
		const cachedFetch = cacheFunctionTTL( fetchData, 1000 );

		await cachedFetch( 1 );
		await cachedFetch( 2 );
		await cachedFetch( 3 );
		expect( fetchData ).toHaveBeenCalledTimes( 3 );

		clearCache();

		await cachedFetch( 1 );
		await cachedFetch( 2 );
		await cachedFetch( 3 );
		expect( fetchData ).toHaveBeenCalledTimes( 6 );
	} );
} );
