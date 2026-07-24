import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OnboardingConnectPage } from './index';
import type { SiteDetails, SyncSite } from '@/data/core';

const mocks = vi.hoisted( () => ( {
	navigate: vi.fn(),
	setProgress: vi.fn(),
	login: vi.fn(),
	signup: vi.fn(),
	remoteRefetch: vi.fn(),
	connectionsRefetch: vi.fn(),
	user: null as { id: number; email: string; displayName: string } | null,
	authLoading: false,
	isOffline: false,
	remoteSites: [] as SyncSite[],
	connections: [] as SyncSite[],
	localSites: [] as SiteDetails[],
	remoteLoading: false,
	connectionsLoading: false,
	remoteError: null as Error | null,
	connectionsError: null as Error | null,
	generateNumberedSiteName: vi.fn(),
	generateProposedSitePath: vi.fn(),
	connectWpcomSite: vi.fn(),
	createSite: vi.fn(),
	deleteSite: vi.fn(),
	pullSite: vi.fn(),
	startSite: vi.fn(),
	toastError: vi.fn(),
} ) );

vi.mock( '@tanstack/react-router', () => ( {
	createRoute: () => ( {} ),
	useNavigate: () => mocks.navigate,
} ) );

vi.mock( '../layout-onboarding', () => ( {
	onboardingLayoutRoute: {},
	useOnboardingProgress: () => ( { setProgress: mocks.setProgress } ),
} ) );

vi.mock( '@/data/core', () => ( {
	useConnector: () => ( {
		generateNumberedSiteName: mocks.generateNumberedSiteName,
		generateProposedSitePath: mocks.generateProposedSitePath,
		connectWpcomSite: mocks.connectWpcomSite,
		openExternalUrl: vi.fn(),
	} ),
} ) );

vi.mock( '@/data/queries/use-auth-user', () => ( {
	useAuthUser: () => ( { data: mocks.user, isLoading: mocks.authLoading } ),
	useLogin: ( options: { signup?: boolean } = {} ) => ( {
		mutate: options.signup ? mocks.signup : mocks.login,
		isPending: false,
		error: null,
	} ),
} ) );

vi.mock( '@/data/queries/use-sites', () => ( {
	useSites: () => ( { data: mocks.localSites } ),
	useCreateSite: () => ( { mutateAsync: mocks.createSite } ),
	useDeleteSite: () => ( { mutateAsync: mocks.deleteSite } ),
	useStartSite: () => ( { mutateAsync: mocks.startSite } ),
} ) );

vi.mock( '@/data/queries/use-sync-site', () => ( {
	usePullSiteFromLive: () => ( { mutateAsync: mocks.pullSite } ),
} ) );

vi.mock( '@/data/queries/use-wpcom-sites', () => ( {
	useSyncableWpcomSites: () => ( {
		data: mocks.remoteSites,
		isLoading: mocks.remoteLoading,
		isFetching: false,
		error: mocks.remoteError,
		refetch: mocks.remoteRefetch,
	} ),
	useAllConnectedWpcomSites: () => ( {
		data: mocks.connections,
		isLoading: mocks.connectionsLoading,
		isFetching: false,
		error: mocks.connectionsError,
		refetch: mocks.connectionsRefetch,
	} ),
} ) );

vi.mock( '@/hooks/use-offline', () => ( {
	useOffline: () => mocks.isOffline,
} ) );

vi.mock( '@/data/app-messages', () => ( {
	toast: { error: mocks.toastError },
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

describe( 'OnboardingConnectPage', () => {
	beforeEach( () => {
		vi.clearAllMocks();
		mocks.user = null;
		mocks.authLoading = false;
		mocks.isOffline = false;
		mocks.remoteSites = [];
		mocks.connections = [];
		mocks.localSites = [];
		mocks.remoteLoading = false;
		mocks.connectionsLoading = false;
		mocks.remoteError = null;
		mocks.connectionsError = null;
		mocks.generateNumberedSiteName.mockResolvedValue( 'Remote site' );
		mocks.generateProposedSitePath.mockResolvedValue( {
			path: '/sites/remote-site',
			isEmpty: true,
		} );
		mocks.connectWpcomSite.mockResolvedValue( undefined );
		mocks.createSite.mockResolvedValue( {
			id: 'local-1',
			name: 'Remote site',
			path: '/sites/remote-site',
		} );
		mocks.deleteSite.mockResolvedValue( undefined );
		mocks.pullSite.mockResolvedValue( undefined );
		mocks.startSite.mockResolvedValue( undefined );
	} );

	it( 'offers login and signup without leaving the Connect flow', () => {
		render( <OnboardingConnectPage /> );

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
		expect( mocks.navigate ).not.toHaveBeenCalled();
	} );

	it( 'shows provider, environment, syncability, and local connection information', () => {
		mocks.user = { id: 1, email: 'user@example.com', displayName: 'User' };
		mocks.remoteSites = [
			site( 1, { name: 'Pressable store', isPressable: true, environmentType: 'staging' } ),
			site( 2, { name: 'Already local' } ),
			site( 3, { name: 'Free site', syncSupport: 'needs-upgrade', planName: 'Free' } ),
		];
		mocks.connections = [ site( 2, { localSiteId: 'local-2' } ) ];
		mocks.localSites = [ { id: 'local-2', name: 'Local copy' } as SiteDetails ];

		render( <OnboardingConnectPage /> );

		expect( screen.getByText( 'Pressable' ) ).toBeInTheDocument();
		expect( screen.getByText( 'Staging' ) ).toBeInTheDocument();
		expect( screen.getByText( 'Connected to: Local copy' ) ).toBeInTheDocument();
		expect( screen.getByText( 'Plan upgrade required' ) ).toBeInTheDocument();

		fireEvent.change( screen.getByRole( 'searchbox', { name: 'Search sites' } ), {
			target: { value: 'Pressable' },
		} );
		expect( screen.getByText( 'Pressable store' ) ).toBeInTheDocument();
		expect( screen.queryByText( 'Already local' ) ).not.toBeInTheDocument();
	} );

	it( 'shows an offline state instead of fetching remote sites', () => {
		mocks.user = { id: 1, email: 'user@example.com', displayName: 'User' };
		mocks.isOffline = true;

		render( <OnboardingConnectPage /> );

		expect( screen.getByRole( 'status' ) ).toHaveTextContent( "You're offline" );
		expect( screen.getByRole( 'button', { name: 'Connect site' } ) ).toHaveAttribute(
			'aria-disabled',
			'true'
		);
	} );

	it( 'shows loading and empty account states', () => {
		mocks.user = { id: 1, email: 'user@example.com', displayName: 'User' };
		mocks.remoteLoading = true;
		const { rerender } = render( <OnboardingConnectPage /> );

		expect( screen.getByRole( 'status' ) ).toHaveTextContent( 'Loading your sites…' );

		mocks.remoteLoading = false;
		rerender( <OnboardingConnectPage /> );
		expect( screen.getByRole( 'heading', { name: 'No sites found' } ) ).toBeInTheDocument();
	} );

	it( 'adapts a single available site into a preselected account view', async () => {
		mocks.user = { id: 1, email: 'user@example.com', displayName: 'User' };
		mocks.remoteSites = [ site( 1, { name: 'Only site' } ) ];

		render( <OnboardingConnectPage /> );

		expect( screen.getByRole( 'heading', { name: 'Connect your site' } ) ).toBeInTheDocument();
		expect( screen.queryByRole( 'searchbox' ) ).not.toBeInTheDocument();
		await waitFor( () =>
			expect( screen.getByRole( 'button', { name: 'Connect site' } ) ).toHaveAttribute(
				'aria-disabled',
				'false'
			)
		);
	} );

	it( 'retries both the remote site and connection requests after an error', () => {
		mocks.user = { id: 1, email: 'user@example.com', displayName: 'User' };
		mocks.remoteError = new Error( 'network failed' );

		render( <OnboardingConnectPage /> );
		fireEvent.click( screen.getByRole( 'button', { name: 'Retry' } ) );

		expect( mocks.remoteRefetch ).toHaveBeenCalledOnce();
		expect( mocks.connectionsRefetch ).toHaveBeenCalledOnce();
	} );

	it( 'opens the local site while pull and start continue in the background', async () => {
		mocks.user = { id: 1, email: 'user@example.com', displayName: 'User' };
		mocks.remoteSites = [ site( 1, { name: 'Remote site' } ) ];
		let finishPull: () => void = () => {};
		mocks.pullSite.mockImplementation( () => {
			return new Promise< void >( ( resolve ) => {
				finishPull = resolve;
			} );
		} );

		render( <OnboardingConnectPage /> );
		const connectButton = screen.getByRole( 'button', { name: 'Connect site' } );
		await waitFor( () => expect( connectButton ).toHaveAttribute( 'aria-disabled', 'false' ) );
		fireEvent.click( connectButton );

		await waitFor( () =>
			expect( mocks.navigate ).toHaveBeenCalledWith( {
				to: '/sites/$siteId/overview',
				params: { siteId: 'local-1' },
				search: { sync: 'pull' },
			} )
		);
		expect( mocks.generateNumberedSiteName ).toHaveBeenCalledOnce();
		expect( mocks.startSite ).not.toHaveBeenCalled();

		finishPull();
		await waitFor( () => expect( mocks.startSite ).toHaveBeenCalledWith( 'local-1' ) );
	} );

	it( 'opens the retained local site after a post-persistence failure', async () => {
		mocks.user = { id: 1, email: 'user@example.com', displayName: 'User' };
		mocks.remoteSites = [ site( 1, { name: 'Remote site' } ) ];
		mocks.pullSite.mockRejectedValue( new Error( 'Remote backup failed' ) );

		render( <OnboardingConnectPage /> );
		const connectButton = screen.getByRole( 'button', { name: 'Connect site' } );
		await waitFor( () => expect( connectButton ).toHaveAttribute( 'aria-disabled', 'false' ) );
		fireEvent.click( connectButton );

		await waitFor( () =>
			expect( mocks.navigate ).toHaveBeenCalledWith( {
				to: '/sites/$siteId/overview',
				params: { siteId: 'local-1' },
				search: { sync: 'pull' },
			} )
		);
		expect( mocks.deleteSite ).not.toHaveBeenCalled();
		expect( mocks.startSite ).not.toHaveBeenCalled();
	} );
} );
