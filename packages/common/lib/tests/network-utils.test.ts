import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isOnline } from '@studio/common/lib/network-utils';

const { lookup, resolve } = vi.hoisted( () => ( {
	lookup: vi.fn(),
	resolve: vi.fn(),
} ) );

vi.mock( 'dns/promises', () => ( {
	default: { lookup, resolve },
} ) );

const HOST = 'public-api.wordpress.com';
const IPV4 = { address: '192.0.78.9', family: 4 };
const IPV6 = { address: '2a04:fa87:fffd::c000:4e09', family: 6 };
const notFound = () =>
	Object.assign( new Error( `getaddrinfo ENOTFOUND ${ HOST }` ), { code: 'ENOTFOUND' } );
const pending = () => new Promise< never >( () => {} );

function answer( v4: () => Promise< unknown >, v6: () => Promise< unknown > ) {
	lookup.mockImplementation( ( _host: string, options: { family: number } ) =>
		options.family === 6 ? v6() : v4()
	);
}

describe( 'isOnline', () => {
	beforeEach( () => {
		vi.useFakeTimers();
		lookup.mockReset();
		resolve.mockReset();
	} );

	afterEach( () => {
		vi.useRealTimers();
	} );

	it( 'returns true when the operating system resolver answers over IPv4', async () => {
		answer(
			() => Promise.resolve( IPV4 ),
			() => Promise.reject( notFound() )
		);

		await expect( isOnline() ).resolves.toBe( true );

		expect( lookup ).toHaveBeenCalledWith( HOST, { family: 4 } );
		expect( lookup ).toHaveBeenCalledWith( HOST, { family: 6 } );
	} );

	it( 'returns true on an IPv6-only network', async () => {
		answer(
			() => Promise.reject( notFound() ),
			() => Promise.resolve( IPV6 )
		);

		await expect( isOnline() ).resolves.toBe( true );
	} );

	it( 'returns false when neither family resolves', async () => {
		answer(
			() => Promise.reject( notFound() ),
			() => Promise.reject( notFound() )
		);

		await expect( isOnline() ).resolves.toBe( false );
	} );

	it( 'does not wait for a slow IPv6 answer once IPv4 has resolved', async () => {
		answer( () => Promise.resolve( IPV4 ), pending );

		// No timers are advanced: the result must come from the IPv4 answer alone.
		await expect( isOnline() ).resolves.toBe( true );
	} );

	it( 'returns false when the resolver hangs past the timeout', async () => {
		answer( pending, pending );

		const result = isOnline();
		await vi.advanceTimersByTimeAsync( 5000 );

		await expect( result ).resolves.toBe( false );
	} );

	it( 'uses the OS resolver, not the c-ares based dns.resolve()', async () => {
		answer(
			() => Promise.resolve( IPV4 ),
			() => Promise.resolve( IPV6 )
		);

		await isOnline();

		expect( resolve ).not.toHaveBeenCalled();
	} );

	it( 'clears its timeout so a quick answer does not keep the process alive', async () => {
		answer(
			() => Promise.resolve( IPV4 ),
			() => Promise.resolve( IPV6 )
		);

		await isOnline();

		expect( vi.getTimerCount() ).toBe( 0 );
	} );
} );
