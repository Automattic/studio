import { SYNC_CANCELLED_MESSAGE } from '@studio/common/lib/sync/cancel';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toast } from '@/data/app-messages';
import { useConnector } from '@/data/core';
import { connectedWpcomSitesQueryKey } from '@/data/queries/use-connected-wpcom-sites';
import { useSiteSyncActivity } from '@/data/sync-activity';
import { usePullSiteFromLive, usePushSiteToLive, useSyncActivityEvents } from './use-sync-site';
import type { Connector } from '@/data/core';
import type { SyncEvent } from '@studio/common/lib/sync/activity';

vi.mock( '@/data/core', async ( importOriginal ) => {
	const actual = await importOriginal< typeof import('@/data/core') >();
	return { ...actual, useConnector: vi.fn() };
} );

vi.mock( '@/data/app-messages', () => ( {
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

	it( 'replaces connector details with an actionable pull error', async () => {
		const openStudioLogs = vi.fn().mockResolvedValue( undefined );
		useConnectorMock.mockReturnValue( {
			capabilities: { studioLogs: true },
			trackEvent: vi.fn().mockResolvedValue( undefined ),
			openStudioLogs,
			pullSiteFromLive: vi
				.fn()
				.mockRejectedValue(
					new Error(
						"Error invoking remote method 'pullSiteFromLive': CliCommandError: [Last error message] Failed to initiate backup: 500 status code"
					)
				),
		} as unknown as Connector );
		const queryClient = new QueryClient( {
			defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
		} );
		render(
			<QueryClientProvider client={ queryClient }>
				<Harness />
			</QueryClientProvider>
		);

		fireEvent.click( screen.getByRole( 'button', { name: 'Pull' } ) );
		await passReportGrace();

		const message =
			"Studio couldn't copy the live site. Try again. If the problem continues, check Studio Logs for details.";
		await waitFor( () => expect( screen.getByText( message ) ).toBeVisible() );
		expect( screen.queryByText( /Error invoking remote method/ ) ).not.toBeInTheDocument();
		expect( toast.error ).toHaveBeenCalledWith( "Pull didn't complete", {
			description: message,
			action: { label: 'Open Studio Logs', onClick: expect.any( Function ) },
		} );

		vi.mocked( toast.error ).mock.calls[ 0 ][ 1 ]?.action?.onClick();
		expect( openStudioLogs ).toHaveBeenCalled();
	} );

	it( 'omits the logs hint when the host has no Studio log file', async () => {
		useConnectorMock.mockReturnValue( {
			capabilities: { studioLogs: false },
			trackEvent: vi.fn().mockResolvedValue( undefined ),
			pullSiteFromLive: vi.fn().mockRejectedValue( new Error( 'nope' ) ),
		} as unknown as Connector );
		const queryClient = new QueryClient( {
			defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
		} );
		render(
			<QueryClientProvider client={ queryClient }>
				<Harness />
			</QueryClientProvider>
		);

		fireEvent.click( screen.getByRole( 'button', { name: 'Pull' } ) );
		await passReportGrace();

		await waitFor( () =>
			expect( toast.error ).toHaveBeenCalledWith( "Pull didn't complete", {
				description: "Studio couldn't copy the live site. Try again.",
				action: undefined,
			} )
		);
	} );
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

	it( 'records a successful pull with its duration and sync type', async () => {
		const trackEvent = renderSync( {
			pullSiteFromLive: vi.fn().mockResolvedValue( undefined ),
		} );

		fireEvent.click( screen.getByRole( 'button', { name: 'Pull' } ) );

		await waitFor( () =>
			expect( trackEvent ).toHaveBeenCalledWith( 'studio_sync_pull', {
				success: true,
				sync_type: 'pressable',
				time_ms: expect.any( Number ),
			} )
		);
		expect( trackEvent.mock.calls[ 0 ][ 1 ] ).not.toHaveProperty( 'failure_reason' );
	} );

	it( 'records a failed pull with a classified reason', async () => {
		const trackEvent = renderSync( {
			pullSiteFromLive: vi.fn().mockRejectedValue( new Error( 'ENOSPC: no space left on device' ) ),
		} );

		fireEvent.click( screen.getByRole( 'button', { name: 'Pull' } ) );

		await waitFor( () =>
			expect( trackEvent ).toHaveBeenCalledWith( 'studio_sync_pull', {
				success: false,
				sync_type: 'pressable',
				time_ms: expect.any( Number ),
				failure_reason: 'disk_full',
			} )
		);
	} );

	it( 'records nothing when a pull is cancelled', async () => {
		const trackEvent = renderSync( {
			pullSiteFromLive: vi.fn().mockRejectedValue( new Error( SYNC_CANCELLED_MESSAGE ) ),
		} );

		fireEvent.click( screen.getByRole( 'button', { name: 'Pull' } ) );
		await passReportGrace();

		await waitFor( () => expect( toast.success ).toHaveBeenCalledWith( 'Pull cancelled' ) );
		expect( trackEvent ).not.toHaveBeenCalled();
	} );

	it( 'records a successful push with its duration and sync type', async () => {
		const trackEvent = renderSync( {
			pushSiteToLive: vi.fn().mockResolvedValue( undefined ),
		} );

		fireEvent.click( screen.getByRole( 'button', { name: 'Push' } ) );

		await waitFor( () =>
			expect( trackEvent ).toHaveBeenCalledWith( 'studio_sync_push', {
				success: true,
				sync_type: 'pressable',
				time_ms: expect.any( Number ),
			} )
		);
		expect( trackEvent.mock.calls[ 0 ][ 1 ] ).not.toHaveProperty( 'failure_reason' );
	} );

	it( 'records a failed push with a classified reason', async () => {
		const trackEvent = renderSync( {
			pushSiteToLive: vi.fn().mockRejectedValue( new Error( 'read ECONNRESET' ) ),
		} );

		fireEvent.click( screen.getByRole( 'button', { name: 'Push' } ) );

		await waitFor( () =>
			expect( trackEvent ).toHaveBeenCalledWith( 'studio_sync_push', {
				success: false,
				sync_type: 'pressable',
				time_ms: expect.any( Number ),
				failure_reason: 'network',
			} )
		);
	} );

	it( 'records nothing when a push is cancelled', async () => {
		const trackEvent = renderSync( {
			pushSiteToLive: vi.fn().mockRejectedValue( new Error( SYNC_CANCELLED_MESSAGE ) ),
		} );

		fireEvent.click( screen.getByRole( 'button', { name: 'Push' } ) );
		await passReportGrace();

		await waitFor( () => expect( toast.success ).toHaveBeenCalledWith( 'Push cancelled' ) );
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
