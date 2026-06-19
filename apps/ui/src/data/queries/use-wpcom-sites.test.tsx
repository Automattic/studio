import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ConnectorProvider } from '@/data/core';
import { useSyncableWpcomSites } from './use-wpcom-sites';
import type { Connector, SyncSite } from '@/data/core';
import type { ReactNode } from 'react';

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

describe( 'useSyncableWpcomSites', () => {
	it( 'loads the complete syncable WordPress.com site list from the connector', async () => {
		const sites = [ makeSite( 1 ), makeSite( 2 ) ];
		const fetchSyncableWpcomSites = vi.fn().mockResolvedValue( sites );

		const { result } = renderHook( () => useSyncableWpcomSites(), {
			wrapper: createWrapper( { fetchSyncableWpcomSites } ),
		} );

		await waitFor( () => expect( result.current.data ).toEqual( sites ) );

		expect( fetchSyncableWpcomSites ).toHaveBeenCalledTimes( 1 );
	} );
} );
