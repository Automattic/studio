import { SYNC_CANCELLED_MESSAGE } from '@studio/common/lib/sync/cancel';
import { QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getNoticeHistory } from '@/data/app-messages';
import { ConnectorProvider } from '@/data/core';
import { connectedWpcomSitesQueryKey } from '@/data/queries/use-connected-wpcom-sites';
import { siteThumbnailQueryKey } from '@/data/queries/use-site-thumbnail';
import { SITES_QUERY_KEY } from '@/data/queries/use-sites';
import { WP_VERSION_QUERY_KEY } from '@/data/queries/use-wordpress-versions';
import { getSyncActivity, useSiteSyncActivity } from '@/data/sync-activity';
import { createFakeConnector, makeSite } from '@/test/fake-connector';
import { createTestQueryClient } from '@/test/render';
import { usePullSiteFromLive, usePushSiteToLive, useSyncActivityEvents } from './use-sync-site';
import type { SyncEvent } from '@studio/common/lib/sync/activity';
import type { QueryClient } from '@tanstack/react-query';
import type { ReactNode } from 'react';

// Lets a mutation's fallback settle the sync, after the window the CLI gets to report first.
const passReportGrace = () => act( () => vi.advanceTimersByTimeAsync( 1500 ) );

beforeEach( () => {
	vi.useFakeTimers( { shouldAdvanceTime: true } );
} );

afterEach( () => {
	vi.useRealTimers();
} );

function setup(
	ui: ReactNode,
	{
		studioLogs = false,
		queryClient = createTestQueryClient(),
	}: { studioLogs?: boolean; queryClient?: QueryClient } = {}
) {
	const connector = createFakeConnector(
		{},
		{ capabilities: { nativeFolderPicker: true, annotatePreview: true, studioLogs } }
	);
	render(
		<ConnectorProvider connector={ connector }>
			<QueryClientProvider client={ queryClient }>{ ui }</QueryClientProvider>
		</ConnectorProvider>
	);
	const publish = ( event: SyncEvent ) => connector.emit( 'onSyncActivity', event );
	return { connector, publish };
}

const latestNotice = () => getNoticeHistory()[ 0 ];

function SyncActivityEvents() {
	useSyncActivityEvents();
	return null;
}

function Harness() {
	const pull = usePullSiteFromLive();
	const activity = useSiteSyncActivity( 'site-1' );
	return (
		<>
			<SyncActivityEvents />
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
	// The agent, a terminal or another window can start the sync: the UI only
	// ever sees the activity the CLI publishes.
	it( 'shows and announces a sync this UI did not start', () => {
		const queryClient = createTestQueryClient();
		queryClient.setQueryData( SITES_QUERY_KEY, [ makeSite( { name: 'Demo Site' } ) ] );
		const { publish } = setup( <Harness />, { queryClient } );

		act( () =>
			publish( {
				siteId: 'site-1',
				activity: { kind: 'pending', direction: 'pull', message: 'Creating remote backup… (24%)' },
			} )
		);
		expect( screen.getByText( 'Creating remote backup… (24%)' ) ).toBeVisible();

		act( () => publish( { siteId: 'site-1', activity: { kind: 'success', direction: 'pull' } } ) );
		expect( screen.getByText( 'success' ) ).toBeVisible();
		expect( latestNotice() ).toMatchObject( {
			intent: 'success',
			title: 'Changes pulled into Demo Site',
			action: { label: 'View' },
		} );
	} );

	// An import replaces the site wholesale, so everything read off it is stale.
	it( 'refreshes what an import changed once it settles', () => {
		const queryClient = createTestQueryClient();
		const staleKeys = [
			SITES_QUERY_KEY,
			[ ...WP_VERSION_QUERY_KEY, 'site-2' ],
			siteThumbnailQueryKey( 'site-2' ),
		];
		staleKeys.forEach( ( key ) => queryClient.setQueryData( key, 'before-import' ) );
		const { publish } = setup( <SyncActivityEvents />, { queryClient } );

		act( () =>
			publish( { siteId: 'site-2', activity: { kind: 'pending', direction: 'import' } } )
		);
		act( () =>
			publish( { siteId: 'site-2', activity: { kind: 'success', direction: 'import' } } )
		);

		staleKeys.forEach( ( key ) =>
			expect( queryClient.getQueryState( key )?.isInvalidated ).toBe( true )
		);
		expect( latestNotice() ).toMatchObject( { intent: 'success', title: 'Import finished' } );
	} );

	it( 'announces a button sync once when the CLI reports after it exits', async () => {
		const { connector, publish } = setup( <Harness /> );
		// The CLI's events arrive just after the CLI process has already exited.
		connector.pullSiteFromLive.mockImplementation( async () => {
			setTimeout( () => {
				publish( { siteId: 'site-1', activity: { kind: 'pending', direction: 'pull' } } );
				publish( {
					siteId: 'site-1',
					activity: { kind: 'error', direction: 'pull', message: 'Auth failed' },
				} );
			}, 50 );
			throw new Error( 'Auth failed' );
		} );

		fireEvent.click( screen.getByRole( 'button', { name: 'Pull' } ) );
		await passReportGrace();

		expect( getNoticeHistory().filter( ( notice ) => notice.intent === 'error' ) ).toHaveLength(
			1
		);
	} );

	it.each( [
		[ 'pull', true, 'Pulling didn’t finish', "Couldn't copy the live site." ],
		[ 'import', false, "Import didn't complete", "Couldn't import this backup." ],
	] as const )(
		'shows plain language for a failed %s (logs available: %s)',
		async ( direction, studioLogs, title, copy ) => {
			vi.spyOn( console, 'error' ).mockImplementation( () => undefined );
			const { connector, publish } = setup( <Harness />, { studioLogs } );
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
			expect( latestNotice() ).toMatchObject( {
				intent: 'error',
				title,
				description: expect.stringContaining( copy ),
			} );
			expect( latestNotice().action?.label ).toBe( studioLogs ? 'Open logs' : undefined );
			expect( console.error ).toHaveBeenCalledWith( 'Sync activity failed:', direction, rawError );
			await latestNotice().action?.onClick();
			expect( connector.openStudioLogs ).toHaveBeenCalledTimes( studioLogs ? 1 : 0 );
		}
	);
} );

describe( 'sync Tracks events', () => {
	function SyncHarness( { syncSite }: { syncSite?: { isPressable: boolean } } ) {
		const pull = usePullSiteFromLive();
		const push = usePushSiteToLive();
		const variables = { siteId: 'site-1', remoteSiteId: 42, syncSite: syncSite as never };
		return (
			<>
				<button type="button" onClick={ () => pull.mutate( variables ) }>
					Pull
				</button>
				<button type="button" onClick={ () => push.mutate( variables ) }>
					Push
				</button>
			</>
		);
	}

	function renderSync( { cached = true, syncSite }: { cached?: boolean; syncSite?: object } = {} ) {
		const queryClient = createTestQueryClient();
		if ( cached ) {
			// The `sync_type` prop is read from the connected-sites cache.
			queryClient.setQueryData( connectedWpcomSitesQueryKey( 'site-1' ), [
				{ id: 42, isPressable: true },
			] );
		}
		return setup( <SyncHarness syncSite={ syncSite as never } />, { queryClient } ).connector;
	}

	const directions = [
		[ 'Pull', 'pullSiteFromLive', 'studio_sync_pull' ],
		[ 'Push', 'pushSiteToLive', 'studio_sync_push' ],
	] as const;

	it.each( directions )(
		'records a successful %s with its duration and sync type',
		async ( button, _, event ) => {
			const connector = renderSync();

			fireEvent.click( screen.getByRole( 'button', { name: button } ) );

			await waitFor( () =>
				expect( connector.trackEvent ).toHaveBeenCalledWith( event, {
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
			const connector = renderSync();
			connector[ method ].mockRejectedValue( new Error( 'ENOSPC: no space left on device' ) );

			fireEvent.click( screen.getByRole( 'button', { name: button } ) );

			await waitFor( () =>
				expect( connector.trackEvent ).toHaveBeenCalledWith( event, {
					success: false,
					sync_type: 'pressable',
					time_ms: expect.any( Number ),
					failure_reason: 'disk_full',
				} )
			);
		}
	);

	it.each( directions )( 'records nothing when a %s is cancelled', async ( button, method ) => {
		const connector = renderSync();
		connector[ method ].mockRejectedValue( new Error( SYNC_CANCELLED_MESSAGE ) );

		fireEvent.click( screen.getByRole( 'button', { name: button } ) );
		await passReportGrace();

		await waitFor( () => expect( getSyncActivity( 'site-1' )?.kind ).toBe( 'cancelled' ) );
		expect( getNoticeHistory().some( ( notice ) => notice.intent === 'success' ) ).toBe( false );
		expect( connector.trackEvent ).not.toHaveBeenCalled();
	} );

	it.each( [
		// The onboarding flow creates its local site as it goes, so nothing has
		// ever populated the connected-sites cache for it.
		[ 'a caller-supplied site', { isPressable: true }, 'pressable' ],
		[ 'nothing', undefined, 'unknown' ],
	] )(
		'reads the sync type from %s when the cache has nothing',
		async ( _, syncSite, syncType ) => {
			const connector = renderSync( { cached: false, syncSite } );

			fireEvent.click( screen.getByRole( 'button', { name: 'Pull' } ) );

			await waitFor( () =>
				expect( connector.trackEvent ).toHaveBeenCalledWith(
					'studio_sync_pull',
					expect.objectContaining( { sync_type: syncType } )
				)
			);
		}
	);
} );
