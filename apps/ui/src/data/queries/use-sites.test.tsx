import { SITE_EVENTS } from '@studio/common/lib/cli-events';
import { QueryClientProvider } from '@tanstack/react-query';
import { act, render, renderHook, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { dismissToast, getVisibleToasts } from '@/data/app-messages';
import { ConnectorProvider } from '@/data/core';
import { updateResponsivePreview, useResponsivePreview } from '@/data/responsive-preview';
import { createFakeConnector, makeSite, type FakeConnector } from '@/test/fake-connector';
import { createTestQueryClient } from '@/test/render';
import {
	useAutoStartSites,
	useCreateSite,
	useExportFullSite,
	useExportDatabase,
	useExportBlueprint,
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

	it( 'starts from the list read this launch, not the one persisted before the quit', async () => {
		const site = { ...makeSite(), url: 'http://localhost:9010' };
		const connector = createFakeConnector();
		let readList = ( _sites: SiteDetails[] ) => {};
		connector.getSites.mockImplementation(
			() => new Promise< SiteDetails[] >( ( resolve ) => ( readList = resolve ) )
		);
		const queryClient = createTestQueryClient();
		queryClient.setQueryData( [ 'sites' ], [ site ] );
		const { result } = renderHook(
			() => {
				useSyncSitesWithEvents();
				useAutoStartSites();
				return useSites();
			},
			{
				wrapper: ( { children } ) => (
					<ConnectorProvider connector={ connector }>
						<QueryClientProvider client={ queryClient }>{ children }</QueryClientProvider>
					</ConnectorProvider>
				),
			}
		);

		// The status the CLI reports for each site as the app launches, landing
		// before the list is read.
		const reported = { ...site, name: 'Renamed' };
		act( () =>
			connector.emit( 'onSiteEvent', {
				event: SITE_EVENTS.UPDATED,
				siteId: site.id,
				site: reported,
				running: false,
			} )
		);
		await waitFor( () => expect( result.current.data?.[ 0 ].name ).toBe( 'Renamed' ) );
		await act( async () => readList( [ { ...reported, autoStart: true } ] ) );

		await waitFor( () => expect( connector.startSite ).toHaveBeenCalledWith( site.id ) );
	} );
} );

describe( 'useCreateSite', () => {
	it( 'keeps one dismissible failure per destination and replaces it after a successful retry', async () => {
		const connector = createFakeConnector();
		connector.createSite
			.mockRejectedValueOnce( new Error( 'Folder is not empty' ) )
			.mockRejectedValueOnce( new Error( 'Permission denied' ) )
			.mockResolvedValueOnce( makeSite( { name: 'Bakery' } ) );
		const { result } = renderHook( () => useCreateSite(), { wrapper: providers( connector ) } );
		const params = { name: 'Bakery', path: '/sites/bakery' };
		await expect( result.current.mutateAsync( params ) ).rejects.toThrow();
		const id = getVisibleToasts()[ 0 ].id;
		expect( getVisibleToasts()[ 0 ] ).toMatchObject( {
			title: 'Couldn’t create site: Bakery',
			description: 'Folder is not empty',
			durationMs: 0,
		} );
		expect( getVisibleToasts()[ 0 ].dismissible ).not.toBe( false );
		await expect( result.current.mutateAsync( params ) ).rejects.toThrow();
		expect( getVisibleToasts() ).toHaveLength( 1 );
		expect( getVisibleToasts()[ 0 ] ).toMatchObject( { id, description: 'Permission denied' } );
		await result.current.mutateAsync( params );
		expect( getVisibleToasts() ).toHaveLength( 1 );
		expect( getVisibleToasts()[ 0 ] ).toMatchObject( {
			id,
			title: 'Site created: Bakery',
			intent: 'success',
			durationMs: 4_500,
		} );
	} );

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

it( 'keeps responsive mode off after stopping and restarting a site', async () => {
	const site = makeSite( { id: 'responsive-stop', running: true } );
	const connector = createFakeConnector( { sites: [ site ] } );
	updateResponsivePreview( site.id, { enabled: true } );
	const { result } = renderHook(
		() => ( {
			stop: useStopSite(),
			start: useStartSite(),
			responsive: useResponsivePreview( site.id ),
		} ),
		{ wrapper: providers( connector ) }
	);

	await act( async () => {
		await result.current.stop.mutateAsync( site.id );
		await result.current.start.mutateAsync( site.id );
	} );

	expect( result.current.responsive.enabled ).toBe( false );
} );

describe( 'useSyncSitesWithEvents', () => {
	it.each( [
		[ 'start', true ],
		[ 'stop', false ],
	] as const )(
		'shows the site a %s reports, before its release event, without refetching the list',
		async ( action, running ) => {
			// What the CLI reports, and the sort order only Studio keeps.
			const details = { ...makeSite(), url: 'http://localhost:9010' };
			const site = { ...details, running: ! running, sortOrder: 1000 };
			const connector = createFakeConnector( { sites: [ site ] } );
			connector[ action === 'start' ? 'startSite' : 'stopSite' ].mockImplementation( async () => {
				// The event while the operation still holds the site. Its release
				// event can land after the command finishes.
				connector.emit( 'onSiteEvent', {
					event: SITE_EVENTS.UPDATED,
					siteId: site.id,
					site: { ...details, operation: { pid: 1, kind: action } },
					running,
				} );
				return { ...details, running };
			} );
			const { result } = renderHook(
				() => {
					useSyncSitesWithEvents();
					return { sites: useSites(), start: useStartSite(), stop: useStopSite() };
				},
				{ wrapper: providers( connector ) }
			);
			await waitFor( () => expect( result.current.sites.data ).toBeDefined() );

			await act( async () => {
				await result.current[ action ].mutateAsync( site.id );
			} );

			await waitFor( () =>
				expect( result.current.sites.data ).toEqual( [ { ...site, running } ] )
			);
			expect( connector.getSites ).toHaveBeenCalledTimes( 1 );
		}
	);

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

describe( 'export notices', () => {
	it.each( [
		[ useExportFullSite, 'exportFullSite', 'Exporting site…', 'Site exported' ],
		[ useExportDatabase, 'exportDatabase', 'Exporting database…', 'Database exported' ],
		[ useExportBlueprint, 'exportBlueprint', 'Exporting blueprint…', 'Blueprint exported' ],
	] as const )(
		'keeps %s progress through dismissal and unmount, then records one result',
		async ( useExport, method, progress, success ) => {
			const connector = createFakeConnector();
			let start!: () => void;
			let finish!: ( path: string ) => void;
			connector[ method ].mockImplementation( ( _siteId, options ) => {
				start = () => options?.onStarted?.();
				return new Promise( ( resolve ) => {
					finish = resolve;
				} );
			} );
			const view = renderHook( useExport, { wrapper: providers( connector ) } );
			act( () => view.result.current.mutate( 'site-1' ) );
			await waitFor( () => expect( start ).toBeDefined() );
			expect( getVisibleToasts() ).toHaveLength( 0 );
			act( start );
			expect( getVisibleToasts()[ 0 ] ).toMatchObject( {
				title: progress,
				processing: true,
				dismissible: true,
			} );
			const id = getVisibleToasts()[ 0 ].id;
			act( () => dismissToast( id ) );
			view.unmount();
			await act( async () => finish( '/tmp/ocean.zip' ) );
			expect( getVisibleToasts() ).toHaveLength( 1 );
			expect( getVisibleToasts()[ 0 ] ).toMatchObject( { id, title: success, intent: 'success' } );
			expect( getVisibleToasts()[ 0 ].leaving ).not.toBe( true );
		}
	);

	it( 'keeps a cancelled destination picker quiet', async () => {
		const connector = createFakeConnector();
		connector.exportFullSite.mockResolvedValue( null );
		const view = renderHook( useExportFullSite, { wrapper: providers( connector ) } );
		await act( () => view.result.current.mutateAsync( 'site-1' ) );
		expect( getVisibleToasts() ).toHaveLength( 0 );
	} );

	it( 'replaces progress with a failure', async () => {
		const connector = createFakeConnector();
		connector.exportFullSite.mockImplementation( async ( _siteId, options ) => {
			options?.onStarted?.();
			throw new Error( 'Disk full' );
		} );
		const view = renderHook( useExportFullSite, { wrapper: providers( connector ) } );
		await act( async () => {
			await expect( view.result.current.mutateAsync( 'site-1' ) ).rejects.toThrow( 'Disk full' );
		} );
		expect( getVisibleToasts() ).toHaveLength( 1 );
		expect( getVisibleToasts()[ 0 ] ).toMatchObject( {
			title: 'Failed to export site',
			intent: 'error',
		} );
	} );
} );
