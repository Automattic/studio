import { SYNC_CANCELLED_MESSAGE } from '@studio/common/lib/sync/cancel';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toast } from '@/data/app-messages';
import { useConnector } from '@/data/core';
import { connectedWpcomSitesQueryKey } from '@/data/queries/use-connected-wpcom-sites';
import { siteStorageUsageQueryKey } from '@/data/queries/use-site-storage-usage';
import { siteThumbnailQueryKey } from '@/data/queries/use-site-thumbnail';
import { SITES_QUERY_KEY } from '@/data/queries/use-sites';
import { WP_VERSION_QUERY_KEY } from '@/data/queries/use-wordpress-versions';
import { useSiteSyncActivity } from '@/data/sync-activity';
import { usePullSiteFromLive, usePushSiteToLive, useSyncActivityEvents } from './use-sync-site';
import type { Connector } from '@/data/core';
import type { SyncEvent } from '@studio/common/lib/sync/activity';

vi.mock( '@/data/core', async ( importOriginal ) => {
	const actual = await importOriginal< typeof import('@/data/core') >();
	return { ...actual, useConnector: vi.fn() };
} );

vi.mock( '@/data/app-messages', async ( importOriginal ) => ( {
	...( await importOriginal< typeof import('@/data/app-messages') >() ),
	toast: { success: vi.fn(), error: vi.fn() },
} ) );

const useConnectorMock = vi.mocked( useConnector );

// Lets a mutation's fallback settle the sync, after the window the CLI gets to report first.
const passReportGrace = () => act( () => vi.advanceTimersByTimeAsync( 1500 ) );

beforeEach( () => {
	vi.useFakeTimers( { shouldAdvanceTime: true } );
} );

afterEach( () => {
	vi.useRealTimers();
} );

function SyncActivityEvents() {
	useSyncActivityEvents();
	return null;
}

function Harness() {
	const pull = usePullSiteFromLive();
	const activity = useSiteSyncActivity( 'site-1' );
	return (
		<>
			<button type="button" onClick={ () => pull.mutate( { siteId: 'site-1', remoteSiteId: 42 } ) }>
				Pull
			</button>
			<div>
				{ activity?.kind === 'pending' || activity?.kind === 'error'
					? activity.message
					: activity?.kind }
			</div>
		</>
	);
}

describe( 'usePullSiteFromLive', () => {
	let publish: ( event: SyncEvent ) => void;

	beforeEach( () => {
		vi.clearAllMocks();
		publish = () => {};
		useConnectorMock.mockReturnValue( {
			capabilities: { studioLogs: true },
			trackEvent: vi.fn().mockResolvedValue( undefined ),
			onSyncActivity: vi.fn( ( listener ) => {
				publish = listener;
				return () => {};
			} ),
		} as unknown as Connector );
	} );

	// The agent, a terminal or another window can start the sync: the UI only
	// ever sees the activity the CLI publishes.
	it( 'shows and announces a sync this UI did not start', async () => {
		render(
			<QueryClientProvider client={ new QueryClient() }>
				<SyncActivityEvents />
				<Harness />
			</QueryClientProvider>
		);

		act( () =>
			publish( {
				siteId: 'site-1',
				activity: { kind: 'pending', direction: 'pull', message: 'Creating remote backup… (24%)' },
			} )
		);
		expect( screen.getByText( 'Creating remote backup… (24%)' ) ).toBeVisible();

		act( () => publish( { siteId: 'site-1', activity: { kind: 'success', direction: 'pull' } } ) );
		expect( screen.getByText( 'success' ) ).toBeVisible();
		expect( toast.success ).toHaveBeenCalledWith( 'Pull complete' );
	} );

	// An import replaces the site wholesale, so everything read off it is stale —
	// disk usage caches for minutes and the overview never unmounts.
	it( 'refreshes what an import changed once it settles', () => {
		const queryClient = new QueryClient();
		const staleKeys = [
			SITES_QUERY_KEY,
			[ ...WP_VERSION_QUERY_KEY, 'site-2' ],
			siteStorageUsageQueryKey( 'site-2' ),
			siteThumbnailQueryKey( 'site-2' ),
		];
		staleKeys.forEach( ( key ) => queryClient.setQueryData( key, 'before-import' ) );
		render(
			<QueryClientProvider client={ queryClient }>
				<SyncActivityEvents />
			</QueryClientProvider>
		);

		act( () =>
			publish( { siteId: 'site-2', activity: { kind: 'pending', direction: 'import' } } )
		);
		act( () =>
			publish( { siteId: 'site-2', activity: { kind: 'success', direction: 'import' } } )
		);

		staleKeys.forEach( ( key ) =>
			expect( queryClient.getQueryState( key )?.isInvalidated ).toBe( true )
		);
		expect( toast.success ).toHaveBeenCalledWith( 'Import finished' );
	} );

	it( 'announces a button sync once when the CLI reports after it exits', async () => {
		useConnectorMock.mockReturnValue( {
			capabilities: { studioLogs: false },
			trackEvent: vi.fn().mockResolvedValue( undefined ),
			onSyncActivity: ( listener: typeof publish ) => {
				publish = listener;
				return () => {};
			},
			// The CLI's events arrive just after the CLI process has already exited.
			pullSiteFromLive: vi.fn( async () => {
				setTimeout( () => {
					publish( { siteId: 'site-1', activity: { kind: 'pending', direction: 'pull' } } );
					publish( {
						siteId: 'site-1',
						activity: { kind: 'error', direction: 'pull', message: 'Auth failed' },
					} );
				}, 50 );
				throw new Error( 'Auth failed' );
			} ),
		} as unknown as Connector );
		render(
			<QueryClientProvider client={ new QueryClient() }>
				<SyncActivityEvents />
				<Harness />
			</QueryClientProvider>
		);

		fireEvent.click( screen.getByRole( 'button', { name: 'Pull' } ) );
		await passReportGrace();

		expect( toast.error ).toHaveBeenCalledOnce();
	} );

	it.each( [
		[ 'pull', true, "Pull didn't complete", "Studio couldn't copy the live site." ],
		[ 'import', false, "Import didn't complete", "Studio couldn't import this backup." ],
	] as const )(
		'shows plain language for a failed %s (logs available: %s)',
		( direction, studioLogs, title, copy ) => {
			vi.spyOn( console, 'error' ).mockImplementation( () => undefined );
			const openStudioLogs = vi.fn().mockResolvedValue( undefined );
			useConnectorMock.mockReturnValue( {
				capabilities: { studioLogs },
				openStudioLogs,
				onSyncActivity: ( listener: typeof publish ) => {
					publish = listener;
					return () => {};
				},
			} as unknown as Connector );
			render(
				<QueryClientProvider client={ new QueryClient() }>
					<SyncActivityEvents />
					<Harness />
				</QueryClientProvider>
			);
			const rawError = 'CliCommandError: [Last error message] Failed: 500 status code';

			act( () => publish( { siteId: 'site-1', activity: { kind: 'pending', direction } } ) );
			act( () =>
				publish( {
					siteId: 'site-1',
					activity: { kind: 'error', direction, message: rawError },
				} )
			);

			expect( screen.getByText( new RegExp( copy ) ) ).toBeVisible();
			expect( screen.queryByText( /CliCommandError/ ) ).not.toBeInTheDocument();
			expect( toast.error ).toHaveBeenCalledWith( title, {
				description: expect.stringContaining( copy ),
				action: studioLogs
					? { label: 'Open Studio Logs', onClick: expect.any( Function ) }
					: undefined,
			} );
			expect( console.error ).toHaveBeenCalledWith( 'Sync activity failed:', direction, rawError );
			vi.mocked( toast.error ).mock.calls[ 0 ][ 1 ]?.action?.onClick();
			expect( openStudioLogs ).toHaveBeenCalledTimes( studioLogs ? 1 : 0 );
		}
	);
} );

describe( 'sync Tracks events', () => {
	function SyncHarness() {
		const pull = usePullSiteFromLive();
		const push = usePushSiteToLive();
		return (
			<>
				<button
					type="button"
					onClick={ () => pull.mutate( { siteId: 'site-1', remoteSiteId: 42 } ) }
				>
					Pull
				</button>
				<button
					type="button"
					onClick={ () => push.mutate( { siteId: 'site-1', remoteSiteId: 42 } ) }
				>
					Push
				</button>
			</>
		);
	}

	function renderSync( connector: Partial< Connector > ) {
		const trackEvent = vi.fn().mockResolvedValue( undefined );
		useConnectorMock.mockReturnValue( {
			capabilities: { studioLogs: false },
			trackEvent,
			...connector,
		} as unknown as Connector );
		const queryClient = new QueryClient( {
			defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
		} );
		// The `sync_type` prop is read from the connected-sites cache.
		queryClient.setQueryData( connectedWpcomSitesQueryKey( 'site-1' ), [
			{ id: 42, isPressable: true },
		] );
		render(
			<QueryClientProvider client={ queryClient }>
				<SyncHarness />
			</QueryClientProvider>
		);
		return trackEvent;
	}

	beforeEach( () => {
		vi.clearAllMocks();
	} );

	const directions = [
		[ 'Pull', 'pullSiteFromLive', 'studio_sync_pull' ],
		[ 'Push', 'pushSiteToLive', 'studio_sync_push' ],
	] as const;

	it.each( directions )(
		'records a successful %s with its duration and sync type',
		async ( button, method, event ) => {
			const trackEvent = renderSync( { [ method ]: vi.fn().mockResolvedValue( undefined ) } );

			fireEvent.click( screen.getByRole( 'button', { name: button } ) );

			await waitFor( () =>
				expect( trackEvent ).toHaveBeenCalledWith( event, {
					success: true,
					sync_type: 'pressable',
					time_ms: expect.any( Number ),
				} )
			);
		}
	);

	it.each( directions )(
		'records a failed %s with a classified reason',
		async ( button, method, event ) => {
			const trackEvent = renderSync( {
				[ method ]: vi.fn().mockRejectedValue( new Error( 'ENOSPC: no space left on device' ) ),
			} );

			fireEvent.click( screen.getByRole( 'button', { name: button } ) );

			await waitFor( () =>
				expect( trackEvent ).toHaveBeenCalledWith( event, {
					success: false,
					sync_type: 'pressable',
					time_ms: expect.any( Number ),
					failure_reason: 'disk_full',
				} )
			);
		}
	);

	it.each( directions )( 'records nothing when a %s is cancelled', async ( button, method ) => {
		const trackEvent = renderSync( {
			[ method ]: vi.fn().mockRejectedValue( new Error( SYNC_CANCELLED_MESSAGE ) ),
		} );

		fireEvent.click( screen.getByRole( 'button', { name: button } ) );
		await passReportGrace();

		await waitFor( () => expect( toast.success ).toHaveBeenCalledWith( `${ button } cancelled` ) );
		expect( trackEvent ).not.toHaveBeenCalled();
	} );

	// The onboarding flow creates its local site as it goes, so nothing has ever
	// populated the connected-sites cache for it.
	it( 'uses a caller-supplied site when the cache has nothing for it', async () => {
		const trackEvent = vi.fn().mockResolvedValue( undefined );
		useConnectorMock.mockReturnValue( {
			capabilities: { studioLogs: false },
			trackEvent,
			pullSiteFromLive: vi.fn().mockResolvedValue( undefined ),
		} as unknown as Connector );
		const queryClient = new QueryClient( {
			defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
		} );
		function Harness() {
			const pull = usePullSiteFromLive();
			return (
				<button
					type="button"
					onClick={ () =>
						pull.mutate( {
							siteId: 'site-1',
							remoteSiteId: 42,
							syncSite: { isPressable: true } as never,
						} )
					}
				>
					Pull
				</button>
			);
		}
		render(
			<QueryClientProvider client={ queryClient }>
				<Harness />
			</QueryClientProvider>
		);

		fireEvent.click( screen.getByRole( 'button', { name: 'Pull' } ) );

		await waitFor( () =>
			expect( trackEvent ).toHaveBeenCalledWith(
				'studio_sync_pull',
				expect.objectContaining( { sync_type: 'pressable' } )
			)
		);
	} );

	it( 'reports `unknown` sync type when the site is not in the cache', async () => {
		const trackEvent = vi.fn().mockResolvedValue( undefined );
		useConnectorMock.mockReturnValue( {
			capabilities: { studioLogs: false },
			trackEvent,
			pullSiteFromLive: vi.fn().mockResolvedValue( undefined ),
		} as unknown as Connector );
		const queryClient = new QueryClient( {
			defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
		} );
		render(
			<QueryClientProvider client={ queryClient }>
				<SyncHarness />
			</QueryClientProvider>
		);

		fireEvent.click( screen.getByRole( 'button', { name: 'Pull' } ) );

		await waitFor( () =>
			expect( trackEvent ).toHaveBeenCalledWith(
				'studio_sync_pull',
				expect.objectContaining( { sync_type: 'unknown' } )
			)
		);
	} );
} );
