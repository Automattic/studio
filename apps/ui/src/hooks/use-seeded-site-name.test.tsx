import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useFindAvailableSitePath } from '@/data/queries/use-create-site-helpers';
import { useSeededSiteName } from './use-seeded-site-name';

vi.mock( '@/data/queries/use-create-site-helpers', () => ( {
	useFindAvailableSitePath: vi.fn(),
} ) );

const useFindAvailableSitePathMock = vi.mocked( useFindAvailableSitePath );

function deferred< T >() {
	let resolve!: ( value: T ) => void;
	const promise = new Promise< T >( ( promiseResolve ) => {
		resolve = promiseResolve;
	} );
	return { promise, resolve };
}

describe( 'useSeededSiteName', () => {
	it( 'ignores a stale available-name lookup', async () => {
		const first = deferred< { name: string; path: string } >();
		const second = deferred< { name: string; path: string } >();
		const findAvailableSitePath = vi
			.fn()
			.mockReturnValueOnce( first.promise )
			.mockReturnValueOnce( second.promise );
		useFindAvailableSitePathMock.mockReturnValue( findAvailableSitePath );

		const { result, rerender } = renderHook(
			( { name }: { name: string | null } ) => useSeededSiteName( name ),
			{ initialProps: { name: 'Portfolio' } }
		);
		rerender( { name: 'Store' } );

		await act( async () => {
			second.resolve( { name: 'Store 2', path: '/sites/store-2' } );
			await second.promise;
		} );
		expect( result.current ).toBe( 'Store 2' );

		await act( async () => {
			first.resolve( { name: 'Portfolio 2', path: '/sites/portfolio-2' } );
			await first.promise;
		} );
		expect( result.current ).toBe( 'Store 2' );
	} );

	it( 'falls back to the requested name when lookup fails', async () => {
		useFindAvailableSitePathMock.mockReturnValue( vi.fn().mockRejectedValue( new Error() ) );
		const { result } = renderHook( () => useSeededSiteName( 'Portfolio' ) );

		await waitFor( () => expect( result.current ).toBe( 'Portfolio' ) );
	} );
} );
