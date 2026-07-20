import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useConnector } from '@/data/core';
import { useAutoStartSites } from './use-sites';
import type { Connector, SiteDetails } from '@/data/core';

vi.mock( '@/data/core', async ( importOriginal ) => {
	const actual = await importOriginal< typeof import('@/data/core') >();
	return {
		...actual,
		useConnector: vi.fn(),
	};
} );

const useConnectorMock = vi.mocked( useConnector );

function createSite( overrides: Partial< SiteDetails > ): SiteDetails {
	return {
		id: 'site-1',
		name: 'Site',
		path: '/sites/site',
		port: 8881,
		running: false,
		phpVersion: '8.2',
		...overrides,
	} as SiteDetails;
}

function Harness() {
	useAutoStartSites();
	return null;
}

describe( 'useAutoStartSites', () => {
	const startSite = vi.fn( () => Promise.resolve() );

	beforeEach( () => {
		vi.clearAllMocks();
		useConnectorMock.mockReturnValue( {
			getSites: vi.fn( () =>
				Promise.resolve( [
					createSite( { id: 'stopped-auto-start', autoStart: true } ),
					createSite( { id: 'already-running', autoStart: true, running: true } ),
					createSite( { id: 'stopped-no-flag' } ),
				] )
			),
			startSite,
		} as unknown as Connector );
	} );

	it( 'starts only the stopped sites flagged for auto-start', async () => {
		const queryClient = new QueryClient( {
			defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
		} );

		render(
			<QueryClientProvider client={ queryClient }>
				<Harness />
			</QueryClientProvider>
		);

		await waitFor( () => expect( startSite ).toHaveBeenCalledWith( 'stopped-auto-start' ) );
		expect( startSite ).toHaveBeenCalledTimes( 1 );
	} );
} );
