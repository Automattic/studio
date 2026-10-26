import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ConnectorProvider } from '@/data/core';
import { useSyncActivityEvents } from '@/data/queries/use-sync-site';
import { applySyncActivity } from '@/data/sync-activity';
import { requestHeaderPanel } from '@/data/use-open-header-panel';
import { useSyncConnectSiteListener } from '@/features/sync/use-sync-connect-site-listener';
import { PublishButton } from './index';
import type { Connector, SiteDetails, SyncSite } from '@/data/core';

// Sync activity outlives a render, so every test publishes its own site.
let siteCount = 0;

const site: SiteDetails = {
	id: 'site',
	name: 'Ada Portfolio',
	path: '/tmp/ada',
	port: 8881,
	running: true,
	phpVersion: '8.3',
};

const remote: SyncSite = {
	id: 101,
	localSiteId: 'site-1',
	name: 'Ada Portfolio',
	url: 'https://ada.wordpress.com',
	isStaging: false,
	isPressable: false,
	syncSupport: 'already-connected',
	lastPullTimestamp: null,
	lastPushTimestamp: '2026-10-21T07:40:00.000Z',
};

function AppEvents() {
	useSyncActivityEvents();
	useSyncConnectSiteListener();
	return null;
}

function renderButton(
	overrides: Partial< Connector > = {},
	siteOverrides: Partial< SiteDetails > = {}
) {
	const testSite = { ...site, ...siteOverrides, id: `site-${ ++siteCount }` };
	const connector = {
		capabilities: {},
		getAuthUser: vi
			.fn()
			.mockResolvedValue( { id: 1, email: 'ada@example.com', displayName: 'Ada' } ),
		getUserPreferences: vi.fn().mockResolvedValue( {} ),
		getConnectedWpcomSites: vi.fn().mockResolvedValue( [ remote ] ),
		fetchSyncableWpcomSites: vi
			.fn()
			.mockResolvedValue( [ { ...remote, syncSupport: 'syncable' } ] ),
		listLocalFileTree: vi.fn().mockResolvedValue( [
			{
				name: 'plugins',
				isDirectory: true,
				path: 'wp-content/plugins',
				children: [
					{ name: 'akismet', isDirectory: true, path: 'wp-content/plugins/akismet' },
					{
						name: 'shared',
						isDirectory: true,
						isSymlink: true,
						path: 'wp-content/plugins/shared',
					},
				],
			},
		] ),
		getDirectorySize: vi.fn().mockResolvedValue( 1024 ),
		getFileSize: vi.fn().mockResolvedValue( 1 ),
		getIsMultisite: vi.fn().mockResolvedValue( false ),
		getWpVersion: vi.fn().mockResolvedValue( '6.8' ),
		getHostingPhpVersion: vi.fn().mockResolvedValue( '8.3' ),
		pushSiteToLive: vi.fn().mockResolvedValue( undefined ),
		pullSiteFromLive: vi.fn().mockResolvedValue( undefined ),
		startSite: vi.fn().mockResolvedValue( undefined ),
		getSites: vi.fn().mockResolvedValue( [] ),
		onSyncActivity: vi.fn( () => () => {} ),
		onSyncConnectSite: vi.fn( () => () => {} ),
		connectWpcomSite: vi.fn().mockResolvedValue( undefined ),
		getPublishCheckoutUrl: vi.fn( () => 'https://wordpress.com/checkout' ),
		openExternalUrl: vi.fn().mockResolvedValue( undefined ),
		trackEvent: vi.fn(),
		...overrides,
	} as unknown as Connector;
	const queryClient = new QueryClient( { defaultOptions: { queries: { retry: false } } } );
	render(
		<QueryClientProvider client={ queryClient }>
			<ConnectorProvider connector={ connector }>
				<AppEvents />
				<PublishButton site={ testSite } />
			</ConnectorProvider>
		</QueryClientProvider>
	);
	return { connector, site: testSite };
}

describe( 'PublishButton', () => {
	it( 'publishes the whole site to the connected website', async () => {
		const { connector, site } = renderButton();

		await userEvent.click( screen.getByRole( 'button', { name: 'Publish…' } ) );
		expect( await screen.findByText( 'ada.wordpress.com' ) ).toBeInTheDocument();
		await userEvent.click( await screen.findByRole( 'button', { name: 'Publish' } ) );

		await waitFor( () =>
			expect( connector.pushSiteToLive ).toHaveBeenCalledWith( site.id, remote.id, {
				optionsToSync: [ 'all' ],
			} )
		);
	} );

	it( 'marks symbolic links and publishes only the files picked', async () => {
		const { connector, site } = renderButton();

		await userEvent.click( screen.getByRole( 'button', { name: 'Publish…' } ) );
		const scope = await screen.findByRole( 'combobox', { name: 'What to publish' } );
		await waitFor( () => expect( scope ).toBeEnabled() );
		await userEvent.click( scope );
		await userEvent.click( await screen.findByRole( 'option', { name: 'Choose files…' } ) );
		await userEvent.click( await screen.findByRole( 'button', { name: 'Expand plugins' } ) );
		await userEvent.click( screen.getByRole( 'checkbox', { name: 'shared (symbolic link)' } ) );
		await userEvent.click( screen.getByRole( 'button', { name: 'Done' } ) );
		await userEvent.click( await screen.findByRole( 'button', { name: 'Publish' } ) );

		await waitFor( () =>
			expect( connector.pushSiteToLive ).toHaveBeenCalledWith( site.id, remote.id, {
				optionsToSync: [ 'plugins' ],
				specificSelectionPaths: [ 'plugins/shared' ],
			} )
		);
	} );

	it( 'lets a site connected in Add site retry the first pull that failed', async () => {
		const { connector, site } = renderButton( {
			getLatestRewindId: vi.fn().mockResolvedValue( 'rewind-1' ),
			listRemoteFileTree: vi.fn().mockResolvedValue( [] ),
		} );
		act( () => {
			requestHeaderPanel( { panel: 'publish', siteId: site.id, view: 'pull' } );
			applySyncActivity( site.id, { kind: 'pending', direction: 'pull', remoteSiteId: remote.id } );
			applySyncActivity( site.id, { kind: 'error', direction: 'pull', message: 'Backup failed' } );
		} );

		expect(
			await screen.findByText(
				'Your local site is saved. Retry to finish bringing in its content.'
			)
		).toBeVisible();
		const retry = await screen.findByRole( 'button', { name: 'Try pulling again' } );
		await waitFor( () => expect( retry ).toBeEnabled() );
		await userEvent.click( retry );

		await waitFor( () =>
			expect( connector.pullSiteFromLive ).toHaveBeenCalledWith( site.id, remote.id, {
				optionsToSync: [ 'all' ],
			} )
		);
	} );

	it( 'asks a signed-out user to create an account or log in', async () => {
		renderButton( { getAuthUser: vi.fn().mockResolvedValue( null ) } );

		await userEvent.click( screen.getByRole( 'button', { name: 'Publish…' } ) );

		expect( await screen.findByRole( 'dialog', { name: 'Publish your WordPress' } ) ).toBeVisible();
		expect( screen.getByRole( 'button', { name: 'Create account' } ) ).toBeInTheDocument();
	} );

	it( 'shows why the website picked at checkout could not be set up, and retries it', async () => {
		const created = { ...remote, id: 202, url: 'https://ada-new.wordpress.com' };
		let connectSite: Parameters< Connector[ 'onSyncConnectSite' ] >[ 0 ] = () => {};
		const { connector, site } = renderButton( {
			getConnectedWpcomSites: vi.fn().mockResolvedValue( [] ),
			fetchSyncableWpcomSites: vi.fn().mockResolvedValue( [] ),
			onSyncConnectSite: vi.fn( ( listener ) => {
				connectSite = listener;
				return () => {};
			} ),
		} );

		await userEvent.click( screen.getByRole( 'button', { name: 'Publish…' } ) );
		await userEvent.click(
			await screen.findByRole( 'button', { name: 'Publish on WordPress.com' } )
		);
		expect( screen.getByRole( 'button', { name: 'Waiting for WordPress.com…' } ) ).toBeDisabled();
		connectSite( { remoteSiteId: created.id, studioSiteId: site.id, autoOpenPush: true } );

		expect( await screen.findByRole( 'alert' ) ).toHaveTextContent(
			'Your new website isn’t available yet.'
		);
		expect( connector.connectWpcomSite ).not.toHaveBeenCalled();

		vi.mocked( connector.fetchSyncableWpcomSites ).mockResolvedValue( [
			{ ...created, syncSupport: 'syncable' },
		] );
		await userEvent.click( screen.getByRole( 'button', { name: 'Try again' } ) );

		await waitFor( () =>
			expect( connector.pushSiteToLive ).toHaveBeenCalledWith( site.id, created.id, {
				optionsToSync: [ 'all' ],
			} )
		);
	} );

	it( 'publishes once when the checkout callback arrives twice', async () => {
		let connectSite: Parameters< Connector[ 'onSyncConnectSite' ] >[ 0 ] = () => {};
		const { connector, site } = renderButton( {
			onSyncConnectSite: vi.fn( ( listener ) => {
				connectSite = listener;
				return () => {};
			} ),
		} );

		connectSite( { remoteSiteId: remote.id, studioSiteId: site.id, autoOpenPush: true } );
		connectSite( { remoteSiteId: remote.id, studioSiteId: site.id, autoOpenPush: true } );

		await waitFor( () => expect( connector.pushSiteToLive ).toHaveBeenCalled() );
		expect( connector.connectWpcomSite ).toHaveBeenCalledTimes( 1 );
		expect( connector.pushSiteToLive ).toHaveBeenCalledTimes( 1 );
	} );

	it( 'keeps a site over the size limit from publishing after checkout', async () => {
		let connectSite: Parameters< Connector[ 'onSyncConnectSite' ] >[ 0 ] = () => {};
		const { connector, site } = renderButton( {
			getDirectorySize: vi.fn().mockResolvedValue( Number.MAX_SAFE_INTEGER ),
			onSyncConnectSite: vi.fn( ( listener ) => {
				connectSite = listener;
				return () => {};
			} ),
		} );

		connectSite( { remoteSiteId: remote.id, studioSiteId: site.id, autoOpenPush: true } );
		await userEvent.click( screen.getByRole( 'button', { name: 'Publish…' } ) );

		expect( await screen.findByText( /exceeds the .* GB publishing limit/ ) ).toBeInTheDocument();
		await waitFor( () => expect( connector.connectWpcomSite ).toHaveBeenCalled() );
		expect( connector.pushSiteToLive ).not.toHaveBeenCalled();
	} );

	it( 'says a pull reached Studio when only restarting the site failed, and starts it', async () => {
		let emitActivity: Parameters< Connector[ 'onSyncActivity' ] >[ 0 ] = () => {};
		const { connector, site } = renderButton(
			{
				onSyncActivity: vi.fn( ( listener ) => {
					emitActivity = listener;
					return () => {};
				} ),
			},
			{ running: false }
		);
		emitActivity( {
			siteId: site.id,
			activity: { kind: 'pending', direction: 'pull', remoteSiteId: remote.id },
		} );
		emitActivity( {
			siteId: site.id,
			activity: {
				kind: 'error',
				direction: 'pull',
				message: 'Could not start PHP',
				localChangesApplied: true,
			},
		} );

		await userEvent.click( screen.getByRole( 'button', { name: 'Publish…' } ) );

		expect( await screen.findByText( 'Changes pulled into WordPress Studio' ) ).toBeInTheDocument();
		expect( screen.getByRole( 'alert' ) ).toHaveTextContent(
			'WordPress Studio couldn’t restart the site.'
		);
		await userEvent.click( screen.getByRole( 'button', { name: 'Start site' } ) );
		expect( connector.startSite ).toHaveBeenCalledWith( site.id );
	} );

	it( 'disables publishing to a website the account can no longer reach', async () => {
		renderButton( { fetchSyncableWpcomSites: vi.fn().mockResolvedValue( [] ) } );

		await userEvent.click( screen.getByRole( 'button', { name: 'Publish…' } ) );

		expect(
			await screen.findByText(
				'This website is no longer available to this account. Choose another website.'
			)
		).toBeInTheDocument();
		expect( screen.getByRole( 'button', { name: 'Publish' } ) ).toBeDisabled();
	} );
} );
