import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getVisibleToasts } from '@/data/app-messages';
import { SITES_QUERY_KEY } from '@/data/queries/use-sites';
import { usePullSite } from '@/data/queries/use-sync-site';
import { AppToasts } from '@/features/notifications';
import { createFakeConnector, makeSite } from '@/test/fake-connector';
import { createTestQueryClient, renderWithProviders } from '@/test/render';
import type { SyncEvent } from '@studio/common/lib/sync/activity';

beforeEach( () => {
	vi.useFakeTimers( { shouldAdvanceTime: true } );
} );

afterEach( () => {
	vi.useRealTimers();
} );

describe( 'pull notice cancellation', () => {
	let siteCount = 0;

	function setupPullNotice() {
		const site = makeSite( { id: `pull-notice-${ ++siteCount }`, name: 'Ocean' } );
		const connector = createFakeConnector(
			{ sites: [ site ] },
			{ pullSite: () => new Promise< void >( () => {} ) }
		);
		const queryClient = createTestQueryClient();
		queryClient.setQueryData( SITES_QUERY_KEY, [ site ] );
		function PullButton() {
			const pull = usePullSite();
			return (
				<button
					onClick={ () => pull.mutate( { provider: 'wpcom', siteId: site.id, remoteSiteId: 42 } ) }
				>
					Pull
				</button>
			);
		}
		function Notices() {
			const [ showStart, setShowStart ] = useState( true );
			return (
				<>
					{ showStart && <PullButton /> }
					<button onClick={ () => setShowStart( false ) }>Leave import view</button>
					<AppToasts />
				</>
			);
		}
		renderWithProviders( <Notices />, { connector, queryClient } );
		const publish = ( activity: SyncEvent[ 'activity' ] ) =>
			act( () => connector.emit( 'onSyncActivity', { siteId: site.id, activity } ) );
		return { connector, publish, site };
	}

	it( 'cancels from the notice after the initiating control unmounts', async () => {
		const { connector, publish, site } = setupPullNotice();
		fireEvent.click( await screen.findByRole( 'button', { name: 'Pull' } ) );
		await screen.findByRole( 'button', { name: 'Cancel' } );
		fireEvent.click( screen.getByRole( 'button', { name: 'Leave import view' } ) );
		fireEvent.click( await screen.findByRole( 'button', { name: 'Cancel' } ) );
		await waitFor( () => expect( connector.cancelSync ).toHaveBeenCalledWith( site.id, 42 ) );
		publish( { kind: 'cancelled', direction: 'pull' } );
		expect(
			getVisibleToasts().find( ( notice ) => notice.id === `pull-${ site.id }` )
		).toMatchObject( { title: 'Pull cancelled', action: undefined } );
	} );

	it( 'removes Cancel when local writes start and ignores a stale action', async () => {
		const { connector, publish, site } = setupPullNotice();
		fireEvent.click( await screen.findByRole( 'button', { name: 'Pull' } ) );
		await screen.findByRole( 'button', { name: 'Cancel' } );
		const action = getVisibleToasts().find( ( notice ) => notice.id === `pull-${ site.id }` )!
			.action!;
		publish( {
			kind: 'pending',
			direction: 'pull',
			remoteSiteId: 42,
			action: 'stopSite',
			message: 'Stopping site…',
		} );
		expect( screen.queryByRole( 'button', { name: 'Cancel' } ) ).not.toBeInTheDocument();
		await action.onClick();
		expect( connector.cancelSync ).not.toHaveBeenCalled();
	} );

	it( 'does not offer cancellation for a pull started outside this UI', async () => {
		const { publish } = setupPullNotice();
		await screen.findByRole( 'button', { name: 'Pull' } );
		publish( {
			kind: 'pending',
			direction: 'pull',
			remoteSiteId: 42,
			action: 'download',
			message: 'Downloading backup…',
		} );
		await screen.findByRole( 'dialog', { name: 'Pulling changes…' } );
		expect( screen.queryByRole( 'button', { name: 'Cancel' } ) ).not.toBeInTheDocument();
	} );

	it( 'keeps Cancel disabled across progress updates and preserves an early cancellation result', async () => {
		const { connector, publish } = setupPullNotice();
		let finish!: () => void;
		connector.cancelSync.mockImplementation(
			() => new Promise< void >( ( resolve ) => ( finish = resolve ) )
		);
		fireEvent.click( await screen.findByRole( 'button', { name: 'Pull' } ) );
		fireEvent.click( await screen.findByRole( 'button', { name: 'Cancel' } ) );
		publish( {
			kind: 'pending',
			direction: 'pull',
			remoteSiteId: 42,
			action: 'download',
			message: 'Downloading backup… (42%)',
		} );
		expect( screen.getByRole( 'button', { name: 'Cancel' } ) ).toBeDisabled();
		fireEvent.click( screen.getByRole( 'button', { name: 'Cancel' } ) );
		expect( connector.cancelSync ).toHaveBeenCalledOnce();
		publish( { kind: 'cancelled', direction: 'pull' } );
		await act( async () => finish() );
		act( () => {
			vi.advanceTimersByTime( 300 );
		} );
		expect( screen.getByRole( 'dialog', { name: 'Pull cancelled' } ) ).toBeVisible();
	} );

	it( 'keeps progress visible and allows retrying when the cancellation request fails', async () => {
		const { connector } = setupPullNotice();
		connector.cancelSync.mockRejectedValueOnce( new Error( 'Connection interrupted' ) );
		fireEvent.click( await screen.findByRole( 'button', { name: 'Pull' } ) );
		fireEvent.click( await screen.findByRole( 'button', { name: 'Cancel' } ) );
		await screen.findByRole( 'dialog', { name: 'Action failed' } );
		expect( screen.getByRole( 'button', { name: 'Cancel' } ) ).toBeEnabled();
		fireEvent.click( screen.getByRole( 'button', { name: 'Cancel' } ) );
		await waitFor( () => expect( connector.cancelSync ).toHaveBeenCalledTimes( 2 ) );
		act( () => {
			vi.advanceTimersByTime( 300 );
		} );
		expect( screen.getByRole( 'dialog', { name: 'Pulling changes…' } ) ).toBeVisible();
	} );
} );
