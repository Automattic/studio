import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFakeConnector } from '@/test/fake-connector';
import { renderWithProviders } from '@/test/render';
import { ConnectPanel } from './connect-panel';
import type { SyncSite } from '@/data/core';

function site( id: number, overrides: Partial< SyncSite > = {} ): SyncSite {
	return {
		id,
		localSiteId: '',
		name: `Site ${ id }`,
		url: `https://site-${ id }.example.com`,
		isStaging: false,
		isPressable: false,
		syncSupport: 'syncable',
		lastPullTimestamp: null,
		lastPushTimestamp: null,
		...overrides,
	};
}

function setup( remoteSites: SyncSite[] = [], { signedIn = true } = {} ) {
	const onConnect = vi.fn();
	const connector = createFakeConnector( signedIn ? {} : { user: null }, {
		fetchSyncableWpcomSites: async () => remoteSites,
	} );
	const view = renderWithProviders( <ConnectPanel onConnect={ onConnect } />, { connector } );
	return { ...view, onConnect };
}

afterEach( () => vi.restoreAllMocks() );

describe( 'ConnectPanel', () => {
	it( 'offers login and signup without leaving the Connect flow', async () => {
		const { connector, onConnect } = setup( [], { signedIn: false } );
		connector.authenticate.mockResolvedValue();
		expect(
			await screen.findByRole( 'heading', { name: 'Connect your WordPress' } )
		).toBeVisible();
		fireEvent.click( screen.getByRole( 'button', { name: 'Create account' } ) );
		await waitFor( () =>
			expect( connector.authenticate ).toHaveBeenCalledWith( true, expect.anything() )
		);
		fireEvent.click( screen.getByRole( 'button', { name: 'Log in' } ) );
		await waitFor( () =>
			expect( connector.authenticate ).toHaveBeenCalledWith( false, expect.anything() )
		);
		expect( onConnect ).not.toHaveBeenCalled();
	} );

	it( 'leaves out connected sites, separates unavailable ones and searches', async () => {
		const pressable = site( 1, {
			name: 'Pressable store',
			isPressable: true,
			environmentType: 'staging',
		} );
		const { onConnect } = setup( [
			pressable,
			site( 2, { name: 'Already local', syncSupport: 'already-connected' } ),
			site( 3, { name: 'Free site', syncSupport: 'needs-upgrade', planName: 'Free' } ),
		] );
		fireEvent.click( await screen.findByText( 'Pressable store' ) );
		expect( onConnect ).toHaveBeenCalledWith( pressable );
		expect( screen.getByText( 'Pressable' ) ).toBeVisible();
		expect( screen.getByText( 'Staging' ) ).toBeVisible();
		expect( screen.queryByText( 'Already local' ) ).not.toBeInTheDocument();
		const unavailable = screen
			.getByRole( 'heading', { name: 'Unavailable' } )
			.closest( 'section' )!;
		expect( within( unavailable ).getByText( 'Free site' ).closest( 'button' ) ).toBeDisabled();
		expect(
			within( unavailable ).getByText(
				'Upgrade this site to a supported plan before connecting it.'
			)
		).toBeVisible();

		fireEvent.change( screen.getByRole( 'searchbox', { name: 'Search sites' } ), {
			target: { value: 'Pressable' },
		} );
		expect( screen.getByText( 'Pressable store' ) ).toBeVisible();
		expect( screen.queryByText( 'Free site' ) ).not.toBeInTheDocument();
	} );

	it( 'shows an offline state instead of fetching remote sites', async () => {
		vi.spyOn( navigator, 'onLine', 'get' ).mockReturnValue( false );
		const { connector } = setup( [ site( 1 ) ] );
		expect( await screen.findByRole( 'status' ) ).toHaveTextContent( "You're offline" );
		expect( connector.fetchSyncableWpcomSites ).not.toHaveBeenCalled();
	} );

	it( 'shows loading, then the empty account state', async () => {
		let resolve!: ( sites: SyncSite[] ) => void;
		const { connector } = setup();
		connector.fetchSyncableWpcomSites.mockReturnValue(
			new Promise( ( done ) => ( resolve = done ) )
		);
		expect( await screen.findByRole( 'status', { name: 'Loading your sites…' } ) ).toBeVisible();
		await act( async () => resolve( [] ) );
		expect( await screen.findByRole( 'heading', { name: 'No sites found' } ) ).toBeVisible();
	} );

	it( 'shows a single available site without search, framing a broken thumbnail', async () => {
		const only = site( 1, { name: 'Only site' } );
		const { container, onConnect } = setup( [ only ] );
		fireEvent.click( await screen.findByText( 'Only site' ) );
		expect( onConnect ).toHaveBeenCalledWith( only );
		expect( screen.queryByRole( 'searchbox' ) ).not.toBeInTheDocument();
		fireEvent.error( container.querySelector( 'img' )! );
		expect( container.querySelector( 'img' ) ).not.toBeInTheDocument();
	} );

	it( 'labels a single unavailable site and explains why it cannot connect', async () => {
		setup( [ site( 1, { syncSupport: 'needs-upgrade' } ) ] );
		expect( await screen.findByRole( 'heading', { name: 'Unavailable' } ) ).toBeVisible();
		expect(
			screen.getByText( 'Upgrade this site to a supported plan before connecting it.' )
		).toBeVisible();
		expect( screen.getByText( 'Site 1' ).closest( 'button' ) ).toBeDisabled();
	} );

	it( 'retries the remote site list after an error', async () => {
		const { connector } = setup( [ site( 1, { name: 'Recovered site' } ) ] );
		connector.fetchSyncableWpcomSites.mockRejectedValueOnce( new Error( 'network failed' ) );
		fireEvent.click( await screen.findByRole( 'button', { name: 'Retry' } ) );
		expect( await screen.findByText( 'Recovered site' ) ).toBeVisible();
	} );

	it( 'refreshes the list and links to the supported sites', async () => {
		const { connector } = setup( [ site( 1 ), site( 2 ) ] );
		fireEvent.click( await screen.findByRole( 'button', { name: 'Refresh list' } ) );
		await waitFor( () => expect( connector.fetchSyncableWpcomSites ).toHaveBeenCalledTimes( 2 ) );
		fireEvent.click( screen.getByRole( 'button', { name: /Supported sites/ } ) );
		expect( connector.openExternalUrl ).toHaveBeenCalledWith(
			'https://developer.wordpress.com/docs/developer-tools/studio/sync/#supported-sites'
		);
	} );
} );
