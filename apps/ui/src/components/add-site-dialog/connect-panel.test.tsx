import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConnectPanel } from './connect-panel';
import type { SyncSite } from '@/data/core';

const mocks = vi.hoisted( () => ( {
	onConnect: vi.fn(),
	login: vi.fn(),
	signup: vi.fn(),
	remoteRefetch: vi.fn(),
	openExternalUrl: vi.fn(),
	user: null as { id: number; email: string; displayName: string } | null,
	authLoading: false,
	isOffline: false,
	remoteSites: [] as SyncSite[],
	remoteLoading: false,
	remoteError: null as Error | null,
} ) );

vi.mock( '@/data/core', () => ( {
	useConnector: () => ( { openExternalUrl: mocks.openExternalUrl } ),
} ) );

vi.mock( '@/data/queries/use-auth-user', () => ( {
	useAuthUser: () => ( { data: mocks.user, isLoading: mocks.authLoading } ),
	useLogin: ( options: { signup?: boolean } = {} ) => ( {
		mutate: options.signup ? mocks.signup : mocks.login,
		isPending: false,
		error: null,
	} ),
} ) );

vi.mock( '@/data/queries/use-user-locale', () => ( {
	useUserLocale: () => undefined,
} ) );

vi.mock( '@/data/queries/use-wpcom-sites', () => ( {
	useSyncableWpcomSites: () => ( {
		data: mocks.remoteSites,
		isLoading: mocks.remoteLoading,
		isFetching: false,
		error: mocks.remoteError,
		refetch: mocks.remoteRefetch,
	} ),
} ) );

vi.mock( '@/hooks/use-offline', () => ( {
	useOffline: () => mocks.isOffline,
} ) );

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

describe( 'ConnectPanel', () => {
	beforeEach( () => {
		vi.clearAllMocks();
		mocks.user = null;
		mocks.authLoading = false;
		mocks.isOffline = false;
		mocks.remoteSites = [];
		mocks.remoteLoading = false;
		mocks.remoteError = null;
	} );

	it( 'offers login and signup without leaving the Connect flow', () => {
		render( <ConnectPanel onConnect={ mocks.onConnect } /> );

		expect(
			screen.getByText( 'Log in with your WordPress.com account to see your sites.' )
		).toBeInTheDocument();
		expect( screen.getByText( 'Work on your site locally.' ) ).toBeInTheDocument();
		expect( screen.getByText( 'Sync content, themes, and plugins.' ) ).toBeInTheDocument();
		expect( screen.getByText( 'Supports staging and production sites.' ) ).toBeInTheDocument();

		fireEvent.click( screen.getByRole( 'button', { name: /Log in with WordPress.com/ } ) );
		fireEvent.click( screen.getByRole( 'button', { name: 'Sign up' } ) );

		expect( mocks.login ).toHaveBeenCalledOnce();
		expect( mocks.signup ).toHaveBeenCalledOnce();
		expect( mocks.onConnect ).not.toHaveBeenCalled();
	} );

	it( 'leaves out connected sites and separates unavailable ones', () => {
		mocks.user = { id: 1, email: 'user@example.com', displayName: 'User' };
		mocks.remoteSites = [
			site( 1, { name: 'Pressable store', isPressable: true, environmentType: 'staging' } ),
			site( 2, { name: 'Already local', syncSupport: 'already-connected' } ),
			site( 3, { name: 'Free site', syncSupport: 'needs-upgrade', planName: 'Free' } ),
		];

		render( <ConnectPanel onConnect={ mocks.onConnect } /> );

		expect( screen.getByText( 'Pressable' ) ).toBeInTheDocument();
		expect( screen.getByText( 'Staging' ) ).toBeInTheDocument();
		const unavailableSection = screen
			.getByRole( 'heading', { name: 'Unavailable' } )
			.closest( 'section' )!;
		expect( screen.queryByText( 'Already local' ) ).not.toBeInTheDocument();
		fireEvent.click( screen.getByText( 'Pressable store' ) );
		expect( mocks.onConnect ).toHaveBeenCalledWith( mocks.remoteSites[ 0 ] );
		expect(
			within( unavailableSection ).getByText( 'Free site' ).closest( 'button' )
		).toBeDisabled();
		expect(
			within( unavailableSection ).getByText(
				'Upgrade this site to a supported plan before connecting it.'
			)
		).toBeVisible();
		expect( screen.queryByRole( 'button', { name: /About / } ) ).not.toBeInTheDocument();

		fireEvent.change( screen.getByRole( 'searchbox', { name: 'Search sites' } ), {
			target: { value: 'Pressable' },
		} );
		expect( screen.getByText( 'Pressable store' ) ).toBeInTheDocument();
		expect( screen.queryByText( 'Free site' ) ).not.toBeInTheDocument();
	} );

	it( 'shows an offline state instead of fetching remote sites', () => {
		mocks.user = { id: 1, email: 'user@example.com', displayName: 'User' };
		mocks.isOffline = true;

		render( <ConnectPanel onConnect={ mocks.onConnect } /> );

		expect( screen.getByRole( 'status' ) ).toHaveTextContent( "You're offline" );
	} );

	it( 'shows loading and empty account states', () => {
		mocks.user = { id: 1, email: 'user@example.com', displayName: 'User' };
		mocks.remoteLoading = true;
		const { rerender } = render( <ConnectPanel onConnect={ mocks.onConnect } /> );

		expect( screen.getByRole( 'status' ) ).toHaveTextContent( 'Loading your sites…' );

		mocks.remoteLoading = false;
		rerender( <ConnectPanel onConnect={ mocks.onConnect } /> );
		expect( screen.getByRole( 'heading', { name: 'No sites found' } ) ).toBeInTheDocument();
	} );

	it( 'shows a single available site without search', () => {
		mocks.user = { id: 1, email: 'user@example.com', displayName: 'User' };
		mocks.remoteSites = [ site( 1, { name: 'Only site' } ) ];

		render( <ConnectPanel onConnect={ mocks.onConnect } /> );

		expect( screen.queryByRole( 'searchbox' ) ).not.toBeInTheDocument();
		fireEvent.click( screen.getByText( 'Only site' ) );
		expect( mocks.onConnect ).toHaveBeenCalledWith( mocks.remoteSites[ 0 ] );
	} );

	it( 'keeps an empty frame instead of a broken thumbnail', () => {
		mocks.user = { id: 1, email: 'user@example.com', displayName: 'User' };
		mocks.remoteSites = [ site( 1, { name: 'Only site' } ) ];

		const { container } = render( <ConnectPanel onConnect={ mocks.onConnect } /> );
		fireEvent.error( container.querySelector( 'img' )! );

		expect( container.querySelector( 'img' ) ).not.toBeInTheDocument();
		expect( container.querySelector( '[data-slot="skeleton"]' ) ).toBeInTheDocument();
	} );

	it( 'labels a single unavailable site and explains why it cannot connect', () => {
		mocks.user = { id: 1, email: 'user@example.com', displayName: 'User' };
		mocks.remoteSites = [ site( 1, { syncSupport: 'needs-upgrade' } ) ];

		render( <ConnectPanel onConnect={ mocks.onConnect } /> );

		expect( screen.getByRole( 'heading', { name: 'Unavailable' } ) ).toBeInTheDocument();
		expect(
			screen.getByText( 'Upgrade this site to a supported plan before connecting it.' )
		).toBeVisible();
		expect( screen.getByText( 'Site 1' ).closest( 'button' ) ).toBeDisabled();
	} );

	it( 'refreshes the remote site list after an error', () => {
		mocks.user = { id: 1, email: 'user@example.com', displayName: 'User' };
		mocks.remoteError = new Error( 'network failed' );

		render( <ConnectPanel onConnect={ mocks.onConnect } /> );
		fireEvent.click( screen.getByRole( 'button', { name: 'Retry' } ) );

		expect( mocks.remoteRefetch ).toHaveBeenCalledOnce();
	} );

	it( 'offers refresh and supported-site helpers above the site grid', () => {
		mocks.user = { id: 1, email: 'user@example.com', displayName: 'User' };
		mocks.remoteSites = [ site( 1 ), site( 2 ) ];

		render( <ConnectPanel onConnect={ mocks.onConnect } /> );
		fireEvent.click( screen.getByRole( 'button', { name: 'Refresh list' } ) );
		fireEvent.click( screen.getByRole( 'button', { name: /Supported sites/ } ) );

		expect( mocks.remoteRefetch ).toHaveBeenCalledOnce();
		expect( mocks.openExternalUrl ).toHaveBeenCalledWith(
			'https://developer.wordpress.com/docs/developer-tools/studio/sync/#supported-sites'
		);
	} );
} );
