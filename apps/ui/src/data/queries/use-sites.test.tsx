import { QueryClientProvider } from '@tanstack/react-query';
import { act, render, renderHook, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { getVisibleToasts } from '@/data/app-messages';
import { ConnectorProvider } from '@/data/core';
import { createFakeConnector, makeSite, type FakeConnector } from '@/test/fake-connector';
import { createTestQueryClient } from '@/test/render';
import {
	useAutoStartSites,
	useCreateSite,
	useSites,
	useStartSite,
	useStopSite,
	useSyncSitesWithEvents,
} from './use-sites';
import type { SiteDetails } from '@/data/core';
import type { ReactNode } from 'react';

function providers( connector: FakeConnector ) {
	const queryClient = createTestQueryClient();
	return ( { children }: { children: ReactNode } ) => (
		<ConnectorProvider connector={ connector }>
			<QueryClientProvider client={ queryClient }>{ children }</QueryClientProvider>
		</ConnectorProvider>
	);
}

describe( 'useAutoStartSites', () => {
	function renderAutoStart() {
		const connector = createFakeConnector( {
			sites: [
				makeSite( { id: 'stopped-auto-start', autoStart: true } ),
				makeSite( { id: 'already-running', autoStart: true, running: true } ),
				makeSite( { id: 'stopped-no-flag' } ),
			],
		} );
		renderHook( useAutoStartSites, { wrapper: providers( connector ) } );
		return connector;
	}

	it( 'starts only the stopped sites flagged for auto-start, without announcing them', async () => {
		const connector = renderAutoStart();
		await waitFor( () =>
			expect( connector.startSite ).toHaveBeenCalledWith( 'stopped-auto-start' )
		);
		expect( connector.startSite ).toHaveBeenCalledTimes( 1 );
		expect( getVisibleToasts() ).toHaveLength( 0 );
	} );
} );

describe( 'useCreateSite', () => {
	it( 'announces the created site, and a failure', async () => {
		const connector = createFakeConnector();
		connector.createSite
			.mockResolvedValueOnce( makeSite( { name: 'Bakery' } ) )
			.mockRejectedValueOnce( new Error( 'Folder is not empty' ) );
		const { result } = renderHook( () => useCreateSite(), { wrapper: providers( connector ) } );

		await result.current.mutateAsync( { name: 'Bakery', path: '/sites/bakery' } );
		await expect(
			result.current.mutateAsync( { name: 'Shop', path: '/sites/shop' } )
		).rejects.toThrow();

		await waitFor( () =>
			expect(
				getVisibleToasts().map( ( { title, description } ) => [ title, description ] )
			).toEqual( [
				[ 'Site created: Bakery', undefined ],
				[ 'Couldn’t create site: Shop', 'Folder is not empty' ],
			] )
		);
	} );
} );

describe( 'useStartSite', () => {
	it( 'keeps a busy-site title short and puts recovery and diagnostics in the description', async () => {
		const site = makeSite( { id: 'busy-site', operation: { kind: 'start', pid: 1234 } } );
		const connector = createFakeConnector( { sites: [ site ] } );
		connector.startSite.mockRejectedValue( new Error( 'Server could not listen' ) );
		const { result } = renderHook( () => ( { sites: useSites(), start: useStartSite() } ), {
			wrapper: providers( connector ),
		} );
		await waitFor( () => expect( result.current.sites.data ).toHaveLength( 1 ) );
		await expect( result.current.start.mutateAsync( site.id ) ).rejects.toThrow();
		expect( getVisibleToasts().at( -1 ) ).toMatchObject( {
			title: 'Site is busy',
			description: 'Wait for a site start to finish, then try again.\n\nServer could not listen',
		} );
	} );

	function renderMutations() {
		const connector = createFakeConnector();
		let releaseStop: () => void = () => {};
		connector.stopSite.mockImplementation(
			() =>
				new Promise< void >( ( resolve ) => {
					releaseStop = resolve;
				} )
		);
		const { result } = renderHook( () => ( { start: useStartSite(), stop: useStopSite() } ), {
			wrapper: providers( connector ),
		} );
		return { result, connector, releaseStop: () => releaseStop() };
	}

	it( 'starts and stops without a success toast', async () => {
		const { result, connector, releaseStop } = renderMutations();

		await result.current.start.mutateAsync( 'site-1' );
		const stopping = result.current.stop.mutateAsync( 'site-1' );
		await waitFor( () => expect( connector.stopSite ).toHaveBeenCalledWith( 'site-1' ) );
		releaseStop();
		await stopping;

		expect( connector.startSite ).toHaveBeenCalledWith( 'site-1' );
		expect( getVisibleToasts() ).toHaveLength( 0 );
	} );

	it( 'skips the start while a stop for the same site is in flight', async () => {
		const { result, connector, releaseStop } = renderMutations();

		void result.current.stop.mutateAsync( 'site-1' );
		await waitFor( () => expect( connector.stopSite ).toHaveBeenCalledWith( 'site-1' ) );

		await expect( result.current.start.mutateAsync( 'site-1' ) ).resolves.toBe( false );
		expect( connector.startSite ).not.toHaveBeenCalled();

		releaseStop();
	} );

	it( 'starts a different site while one is stopping', async () => {
		const { result, connector, releaseStop } = renderMutations();

		void result.current.stop.mutateAsync( 'site-1' );
		await waitFor( () => expect( connector.stopSite ).toHaveBeenCalledWith( 'site-1' ) );

		await expect( result.current.start.mutateAsync( 'site-2' ) ).resolves.toBe( true );
		expect( connector.startSite ).toHaveBeenCalledWith( 'site-2' );

		releaseStop();
	} );

	it( 'starts once the stop has settled', async () => {
		const { result, connector, releaseStop } = renderMutations();

		const stopping = result.current.stop.mutateAsync( 'site-1' );
		await waitFor( () => expect( connector.stopSite ).toHaveBeenCalledWith( 'site-1' ) );
		releaseStop();
		await stopping;

		await expect( result.current.start.mutateAsync( 'site-1' ) ).resolves.toBe( true );
		expect( connector.startSite ).toHaveBeenCalledWith( 'site-1' );
	} );
} );

describe( 'useSyncSitesWithEvents', () => {
	it( 'refetches after an in-flight fetch that predates the event', async () => {
		const connector = createFakeConnector();
		const pendingFetches: Array< ( sites: SiteDetails[] ) => void > = [];
		connector.getSites.mockImplementation(
			() => new Promise< SiteDetails[] >( ( resolve ) => pendingFetches.push( resolve ) )
		);
		const { result } = renderHook(
			() => {
				useSyncSitesWithEvents();
				return useSites();
			},
			{ wrapper: providers( connector ) }
		);

		// The release event lands while the fetch is still reading the busy site.
		act( () => connector.emit( 'onSiteEvent', { event: 'site-operations-changed' } as never ) );
		await act( async () =>
			pendingFetches[ 0 ]( [ makeSite( { operation: { pid: 1, kind: 'import' } } ) ] )
		);
		await waitFor( () => expect( pendingFetches ).toHaveLength( 2 ) );
		await act( async () => pendingFetches[ 1 ]( [ makeSite() ] ) );

		await waitFor( () => expect( result.current.data?.[ 0 ].operation ).toBeUndefined() );
	} );
} );

describe( 'useSites', () => {
	function SitesError() {
		useSites();
		return <p>Couldn’t load sites</p>;
	}

	function SiteListShell() {
		const { isError } = useSites();
		return isError ? <SitesError /> : null;
	}

	it( 'keeps a failed list failed when another reader mounts', async () => {
		const connector = createFakeConnector();
		connector.getSites.mockRejectedValue( new Error( 'Registry unavailable' ) );

		render( <SiteListShell />, { wrapper: providers( connector ) } );

		await screen.findByText( 'Couldn’t load sites' );
		await act( () => new Promise( ( resolve ) => setTimeout( resolve, 100 ) ) );
		expect( screen.getByText( 'Couldn’t load sites' ) ).toBeInTheDocument();
		expect( connector.getSites ).toHaveBeenCalledTimes( 1 );
	} );
} );
