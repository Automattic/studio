import { beforeEach, describe, expect, it, vi } from 'vitest';
import { isOnline } from '@studio/common/lib/network-utils';

const { lookup } = vi.hoisted( () => ( { lookup: vi.fn() } ) );

vi.mock( 'dns/promises', () => ( { default: { lookup } } ) );

const found = () => Promise.resolve( { address: '192.0.78.9', family: 4 } );
const notFound = () =>
	Promise.reject( Object.assign( new Error( 'ENOTFOUND' ), { code: 'ENOTFOUND' } ) );
const pending = () => new Promise< never >( () => {} );

function answer( v4: () => Promise< unknown >, v6: () => Promise< unknown > ) {
	lookup.mockImplementation( ( _host: string, { family }: { family: number } ) =>
		family === 6 ? v6() : v4()
	);
}

describe( 'isOnline', () => {
	beforeEach( () => {
		vi.useFakeTimers();
		lookup.mockReset();
		return () => vi.useRealTimers();
	} );

	it.each( [
		{ network: 'IPv4 resolves', v4: found, v6: notFound, online: true },
		{ network: 'only IPv6 resolves', v4: notFound, v6: found, online: true },
		{ network: 'IPv4 resolves while IPv6 never answers', v4: found, v6: pending, online: true },
		{ network: 'nothing resolves', v4: notFound, v6: notFound, online: false },
	] )( 'reports online=$online when $network', async ( { v4, v6, online } ) => {
		answer( v4, v6 );

		await expect( isOnline() ).resolves.toBe( online );
	} );

	it( 'reports offline when the resolver hangs past the timeout', async () => {
		answer( pending, pending );

		const result = isOnline();
		await vi.advanceTimersByTimeAsync( 5000 );

		await expect( result ).resolves.toBe( false );
	} );

	it( 'leaves no timer behind, so a quick answer does not keep the CLI running', async () => {
		answer( found, found );

		await isOnline();

		expect( vi.getTimerCount() ).toBe( 0 );
	} );
} );
