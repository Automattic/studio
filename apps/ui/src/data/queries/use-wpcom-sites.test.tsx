import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ConnectorProvider } from '@/data/core';
import { useSyncableWpcomSitesPages } from './use-wpcom-sites';
import type { Connector, SyncableWpcomSitesPage, SyncSite } from '@/data/core';
import type { ReactNode } from 'react';

const PAGE_SIZE = 12;

function makeSite( id: number ): SyncSite {
	return {
		id,
		localSiteId: '',
		name: `Site ${ id }`,
		url: `https://site-${ id }.example.com`,
		isStaging: false,
		isPressable: false,
		environmentType: null,
		syncSupport: 'syncable',
		lastPullTimestamp: null,
		lastPushTimestamp: null,
	};
}

function makePage( sites: SyncSite[], nextPage: number | null, page = 1 ): SyncableWpcomSitesPage {
	return {
		sites,
		total: 14,
		page,
		perPage: PAGE_SIZE,
		hasMore: nextPage !== null,
		nextPage,
	};
}

function createWrapper( connector: Partial< Connector > ) {
	const queryClient = new QueryClient( {
		defaultOptions: {
			queries: {
				retry: false,
			},
		},
	} );

	return function Wrapper( { children }: { children: ReactNode } ) {
		return (
			<QueryClientProvider client={ queryClient }>
				<ConnectorProvider connector={ connector as Connector }>{ children }</ConnectorProvider>
			</QueryClientProvider>
		);
	};
}

describe( 'useSyncableWpcomSitesPages', () => {
	it( 'loads the first page of syncable WordPress.com sites', async () => {
		const page = makePage( [ makeSite( 1 ) ], 2 );
		const fetchSyncableWpcomSitesPage = vi.fn().mockResolvedValue( page );

		const { result } = renderHook( () => useSyncableWpcomSitesPages(), {
			wrapper: createWrapper( { fetchSyncableWpcomSitesPage } ),
		} );

		await waitFor( () => expect( result.current.data ).toBeDefined() );

		expect( fetchSyncableWpcomSitesPage ).toHaveBeenCalledWith( {
			page: 1,
			perPage: PAGE_SIZE,
			search: undefined,
		} );
		expect( result.current.data?.pages ).toEqual( [ page ] );
		expect( result.current.hasNextPage ).toBe( true );
	} );

	it( 'loads the next page when requested', async () => {
		const firstPage = makePage( [ makeSite( 1 ) ], 2 );
		const secondPage = makePage( [ makeSite( 2 ) ], null, 2 );
		const fetchSyncableWpcomSitesPage = vi
			.fn()
			.mockResolvedValueOnce( firstPage )
			.mockResolvedValueOnce( secondPage );

		const { result } = renderHook( () => useSyncableWpcomSitesPages(), {
			wrapper: createWrapper( { fetchSyncableWpcomSitesPage } ),
		} );

		await waitFor( () => expect( result.current.data?.pages ).toEqual( [ firstPage ] ) );

		await act( async () => {
			await result.current.fetchNextPage();
		} );

		expect( fetchSyncableWpcomSitesPage ).toHaveBeenLastCalledWith( {
			page: 2,
			perPage: PAGE_SIZE,
			search: undefined,
		} );
		await waitFor( () =>
			expect( result.current.data?.pages ).toEqual( [ firstPage, secondPage ] )
		);
		expect( result.current.hasNextPage ).toBe( false );
	} );

	it( 'passes trimmed search terms through to the paged fetch', async () => {
		const page = makePage( [ makeSite( 7 ) ], null );
		const fetchSyncableWpcomSitesPage = vi.fn().mockResolvedValue( page );

		renderHook( () => useSyncableWpcomSitesPages( { search: '  example  ' } ), {
			wrapper: createWrapper( { fetchSyncableWpcomSitesPage } ),
		} );

		await waitFor( () =>
			expect( fetchSyncableWpcomSitesPage ).toHaveBeenCalledWith( {
				page: 1,
				perPage: PAGE_SIZE,
				search: 'example',
			} )
		);
	} );
} );
