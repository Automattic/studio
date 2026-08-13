import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useConnector } from '@/data/core';
import { useAutoStartSites, useStartSite, useStopSite } from './use-sites';
import type { Connector, SiteDetails } from '@/data/core';
import type { ReactNode } from 'react';

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

describe( 'useStartSite', () => {
	const startSite = vi.fn( () => Promise.resolve() );
	let stopSite: ReturnType< typeof vi.fn >;
	let releaseStop: () => void;

	beforeEach( () => {
		vi.clearAllMocks();
		stopSite = vi.fn(
			() =>
				new Promise< void >( ( resolve ) => {
					releaseStop = resolve;
				} )
		);
		useConnectorMock.mockReturnValue( {
			getSites: vi.fn( () => Promise.resolve( [] ) ),
			startSite,
			stopSite,
		} as unknown as Connector );
	} );

	function renderMutations() {
		const queryClient = new QueryClient( {
			defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
		} );
		return renderHook( () => ( { start: useStartSite(), stop: useStopSite() } ), {
			wrapper: ( { children }: { children: ReactNode } ) => (
				<QueryClientProvider client={ queryClient }>{ children }</QueryClientProvider>
			),
		} ).result;
	}

	it( 'skips the start while a stop for the same site is in flight', async () => {
		const result = renderMutations();

		void result.current.stop.mutateAsync( 'site-1' );
		await waitFor( () => expect( stopSite ).toHaveBeenCalledWith( 'site-1' ) );

		await expect( result.current.start.mutateAsync( 'site-1' ) ).resolves.toBe( false );
		expect( startSite ).not.toHaveBeenCalled();

		releaseStop();
	} );

	it( 'starts a different site while one is stopping', async () => {
		const result = renderMutations();

		void result.current.stop.mutateAsync( 'site-1' );
		await waitFor( () => expect( stopSite ).toHaveBeenCalledWith( 'site-1' ) );

		await expect( result.current.start.mutateAsync( 'site-2' ) ).resolves.toBe( true );
		expect( startSite ).toHaveBeenCalledWith( 'site-2' );

		releaseStop();
	} );

	it( 'starts once the stop has settled', async () => {
		const result = renderMutations();

		const stopping = result.current.stop.mutateAsync( 'site-1' );
		await waitFor( () => expect( stopSite ).toHaveBeenCalledWith( 'site-1' ) );
		releaseStop();
		await stopping;

		await expect( result.current.start.mutateAsync( 'site-1' ) ).resolves.toBe( true );
		expect( startSite ).toHaveBeenCalledWith( 'site-1' );
	} );
} );
