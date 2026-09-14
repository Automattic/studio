import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConnectorProvider } from '@/data/core';
import { useSiteStorageUsage } from './use-site-storage-usage';
import type { Connector } from '@/data/core';
import type { ReactNode } from 'react';

const usage = { total: 400, uploads: 400, plugins: 0, themes: 0, database: 0, other: 0 };

function createWrapper( connector: Connector ) {
	const queryClient = new QueryClient( {
		defaultOptions: { queries: { retry: false } },
	} );
	return function Wrapper( { children }: { children: ReactNode } ) {
		return (
			<QueryClientProvider client={ queryClient }>
				<ConnectorProvider connector={ connector }>{ children }</ConnectorProvider>
			</QueryClientProvider>
		);
	};
}

beforeEach( () => {
	vi.useFakeTimers( { shouldAdvanceTime: true } );
} );

afterEach( () => {
	vi.useRealTimers();
} );

describe( 'useSiteStorageUsage', () => {
	it( 'waits for the site to settle before measuring', async () => {
		const getSiteStorageUsage = vi.fn().mockResolvedValue( usage );
		const connector = { getSiteStorageUsage } as unknown as Connector;
		renderHook( () => useSiteStorageUsage( 'site-1' ), {
			wrapper: createWrapper( connector ),
		} );

		expect( getSiteStorageUsage ).not.toHaveBeenCalled();

		await vi.advanceTimersByTimeAsync( 400 );

		await waitFor( () => expect( getSiteStorageUsage ).toHaveBeenCalledOnce() );
	} );

	it( 'never measures a site the user passed straight through', async () => {
		const getSiteStorageUsage = vi.fn().mockResolvedValue( usage );
		const connector = { getSiteStorageUsage } as unknown as Connector;
		const { unmount } = renderHook( () => useSiteStorageUsage( 'site-1' ), {
			wrapper: createWrapper( connector ),
		} );

		await vi.advanceTimersByTimeAsync( 200 );
		unmount();
		await vi.advanceTimersByTimeAsync( 400 );

		expect( getSiteStorageUsage ).not.toHaveBeenCalled();
	} );

	it( 'aborts the measurement when the site is left mid-walk', async () => {
		let capturedSignal: AbortSignal | undefined;
		const getSiteStorageUsage = vi.fn(
			( _siteId: string, signal?: AbortSignal ) =>
				new Promise( ( resolve ) => {
					capturedSignal = signal;
					signal?.addEventListener( 'abort', () => resolve( null ) );
				} )
		);
		const connector = { getSiteStorageUsage } as unknown as Connector;
		const { unmount } = renderHook( () => useSiteStorageUsage( 'site-1' ), {
			wrapper: createWrapper( connector ),
		} );

		await vi.advanceTimersByTimeAsync( 400 );
		await waitFor( () => expect( capturedSignal ).toBeDefined() );
		expect( capturedSignal?.aborted ).toBe( false );

		unmount();

		await waitFor( () => expect( capturedSignal?.aborted ).toBe( true ) );
	} );
} );
