import { onlineManager } from '@tanstack/react-query';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { useSyncExternalStore } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getNoticeHistory, resetAppMessagesForTests } from '@/data/app-messages';
import { requestHeaderPanel } from '@/data/use-open-header-panel';
import { SessionUIProvider } from '@/data/use-session-ui';
import { createFakeConnector, makeSite, TEST_USER } from '@/test/fake-connector';
import { renderWithProviders } from '@/test/render';
import { PublishButton } from './index';
import type { SyncSite } from '@/data/core';
import type { SyncActivity } from '@studio/common/lib/sync/activity';

const remote: SyncSite = {
	id: 42,
	localSiteId: 'local',
	name: 'Hosted site',
	url: 'https://example.com',
	isStaging: false,
	isPressable: false,
	syncSupport: 'syncable',
	lastPushTimestamp: null,
	lastPullTimestamp: null,
};

// Sync activity outlives a render, so every test publishes its own site.
let siteCount = 0;

function createVisibility() {
	let visible = true;
	const listeners = new Set< () => void >();
	return {
		get: () => visible,
		subscribe: ( listener: () => void ) => {
			listeners.add( listener );
			return () => listeners.delete( listener );
		},
		set: ( next: boolean ) =>
			act( () => {
				visible = next;
				listeners.forEach( ( listener ) => listener() );
			} ),
	};
}

function setup( connections: SyncSite[] = [], signedIn = true, running = true ) {
	let connected = connections;
	const site = makeSite( { id: `local-${ ++siteCount }`, name: 'Local site', running } );
	const connector = createFakeConnector(
		{ sites: [ site ], user: signedIn ? TEST_USER : null },
		{
			getConnectedWpcomSites: async () => connected,
			fetchSyncableWpcomSites: async () => [
				...connected.filter( ( item ) => item.id !== remote.id ),
				remote,
			],
			connectWpcomSite: async ( _, target ) => {
				connected = [ target ];
			},
			disconnectWpcomSite: async () => {
				connected = [];
			},
			getPublishCheckoutUrl: () => 'https://wordpress.com/setup/new-hosted-site',
			getHostingPhpVersion: async () => '8.3',
		}
	);
	const visibility = createVisibility();
	function Harness() {
		const visible = useSyncExternalStore( visibility.subscribe, visibility.get );
		return visible ? <PublishButton site={ site } /> : null;
	}
	const view = renderWithProviders(
		<SessionUIProvider>
			<Harness />
		</SessionUIProvider>,
		{ connector }
	);
	const ready = screen
		.findByRole( 'button', { name: 'Publish…' } )
		.then( ( button ) => fireEvent.click( button ) );
	return {
		...view,
		connector,
		site,
		ready,
		hide: () => visibility.set( false ),
		completeSetup: ( autoOpenPush = true ) =>
			act( async () => {
				connector.emit( 'onSyncConnectSite', {
					remoteSiteId: remote.id,
					studioSiteId: site.id,
					autoOpenPush,
				} );
			} ),
		emit: ( activity: SyncActivity ) =>
			act( () => connector.emit( 'onSyncActivity', { siteId: site.id, activity } ) ),
	};
}

async function openPull() {
	fireEvent.click( await screen.findByRole( 'button', { name: 'Website actions' } ) );
	fireEvent.click( await screen.findByRole( 'menuitem', { name: 'Pull changes…' } ) );
	const back = await screen.findByRole( 'button', { name: 'Back to Publish' } );
	await waitFor( () => expect( back ).toHaveFocus() );
}

async function selectScope( name: string, pull = false ) {
	const control = await screen.findByRole( 'combobox', {
		name: pull ? 'What to pull' : 'What to publish',
	} );
	await waitFor( () => expect( control ).toBeEnabled() );
	fireEvent.click( control );
	const option = await screen.findByRole( 'option', { name } );
	fireEvent.pointerDown( option, { pointerType: 'mouse' } );
	fireEvent.click( option );
}

beforeEach( () => {
	resetAppMessagesForTests();
	vi.spyOn( navigator, 'onLine', 'get' ).mockReturnValue( true );
	onlineManager.setOnline( true );
} );

describe( 'PublishPopover', () => {
	it( 'uses the shared account modal with contextual copy before showing existing websites', async () => {
		const { connector, ready } = setup( [], false );
		await ready;
		await screen.findByRole( 'dialog', { name: 'Publish your WordPress' } );
		expect(
			screen.getByText(
				'Create an account or log in to publish a website and keep your sites in sync.'
			)
		).toBeVisible();
		expect( screen.getByRole( 'button', { name: 'Create account' } ) ).toBeVisible();
		expect(
			screen.queryByRole( 'button', { name: 'Use an existing website…' } )
		).not.toBeInTheDocument();
		fireEvent.click( screen.getByRole( 'button', { name: 'Log in' } ) );
		await waitFor( () =>
			expect( connector.authenticate ).toHaveBeenCalledWith( false, 'sync_tab' )
		);
		expect( connector.fetchSyncableWpcomSites ).not.toHaveBeenCalled();
	} );

	it( 'returns login to the site’s publishing state', async () => {
		const { connector, ready } = setup( [], false );
		await ready;
		await screen.findByRole( 'dialog', { name: 'Publish your WordPress' } );
		fireEvent.click( screen.getByRole( 'button', { name: 'Log in' } ) );
		await screen.findByRole( 'button', { name: 'Publish on WordPress.com' } );
		expect( connector.openExternalUrl ).not.toHaveBeenCalled();
	} );

	it( 'continues account creation into new-site setup', async () => {
		const { connector, ready } = setup( [], false );
		await ready;
		await screen.findByRole( 'dialog', { name: 'Publish your WordPress' } );
		fireEvent.click( screen.getByRole( 'button', { name: 'Create account' } ) );
		await waitFor( () =>
			expect( connector.openExternalUrl ).toHaveBeenCalledWith(
				'https://wordpress.com/setup/new-hosted-site'
			)
		);
		expect( connector.authenticate ).toHaveBeenCalledWith( true, 'sync_tab' );
	} );

	it( 'keeps setup continuation alive when its panel unmounts', async () => {
		const { connector, completeSetup, hide, ready, site } = setup();
		await ready;
		fireEvent.click( await screen.findByRole( 'button', { name: 'Publish on WordPress.com' } ) );
		await screen.findByText( 'Waiting for WordPress.com…' );
		hide();
		await completeSetup( true );
		await waitFor( () =>
			expect( connector.pushSiteToLive ).toHaveBeenCalledWith( site.id, 42, {
				optionsToSync: [ 'all' ],
			} )
		);
	} );

	it( 'connects an eligible Pressable website without starting a transfer', async () => {
		const { connector, ready, site } = setup();
		connector.fetchSyncableWpcomSites.mockResolvedValue( [ { ...remote, isPressable: true } ] );
		await ready;
		fireEvent.click( await screen.findByRole( 'button', { name: 'Use an existing website…' } ) );
		fireEvent.click( await screen.findByRole( 'button', { name: /Hosted site.*Pressable/ } ) );
		await screen.findByRole( 'button', { name: 'Publish' } );
		expect( connector.connectWpcomSite ).toHaveBeenCalledWith(
			site.id,
			expect.objectContaining( { id: 42, isPressable: true } )
		);
		expect( connector.pushSiteToLive ).not.toHaveBeenCalled();
	} );

	it( 'publishes immediately with the inline files preset', async () => {
		const { connector, ready, site } = setup( [ remote ] );
		await ready;
		await selectScope( 'Files only' );
		const publish = await screen.findByRole( 'button', { name: 'Publish' } );
		await waitFor( () => expect( publish ).toBeEnabled() );
		fireEvent.click( publish );
		await waitFor( () =>
			expect( connector.pushSiteToLive ).toHaveBeenCalledWith( site.id, 42, {
				optionsToSync: [ 'plugins', 'themes', 'uploads', 'contents' ],
			} )
		);
		await waitFor( () => expect( getNoticeHistory()[ 0 ]?.title ).toBe( 'Published Local site' ), {
			timeout: 3000,
		} );
	} );

	it( 'forces a full pull when no remote backup exists', async () => {
		const { connector, ready, site } = setup( [ remote ] );
		await ready;
		await openPull();
		await waitFor( () =>
			expect( screen.getByRole( 'combobox', { name: 'What to pull' } ) ).toBeDisabled()
		);
		const pull = screen.getByRole( 'button', { name: 'Pull changes' } );
		await waitFor( () => expect( pull ).toBeEnabled() );
		fireEvent.click( pull );
		await waitFor( () =>
			expect( connector.pullSiteFromLive ).toHaveBeenCalledWith( site.id, 42, {
				optionsToSync: [ 'all' ],
			} )
		);
		await screen.findByText( 'Changes pulled into WordPress Studio', {}, { timeout: 3000 } );
	} );

	it( 'keeps publish and pull scopes independent and updates the overwrite explanation', async () => {
		const { connector, ready } = setup( [ remote ] );
		connector.getLatestRewindId.mockResolvedValue( 'backup-1' );
		await ready;
		await selectScope( 'Files only' );
		await openPull();
		await selectScope( 'Content and settings only', true );
		expect(
			await screen.findByText(
				'All content and settings in WordPress Studio will be overwritten. Your website stays unchanged.'
			)
		).toBeVisible();
		fireEvent.click( screen.getByRole( 'button', { name: 'Back to Publish' } ) );
		expect( screen.getByRole( 'combobox', { name: 'What to publish' } ) ).toHaveTextContent(
			'Files only'
		);
		await openPull();
		expect( screen.getByRole( 'combobox', { name: 'What to pull' } ) ).toHaveTextContent(
			'Content and settings only'
		);
	} );

	it( 'retains granular file selection behind the inline control', async () => {
		const { connector, ready, site } = setup( [ remote ] );
		connector.listLocalFileTree.mockResolvedValue( [
			{ name: 'style.css', path: 'wp-content/themes/site/style.css', isDirectory: false },
		] );
		await ready;
		await selectScope( 'Choose files…' );
		fireEvent.click( await screen.findByRole( 'checkbox', { name: 'style.css' } ) );
		fireEvent.click( screen.getByRole( 'button', { name: 'Done' } ) );
		await selectScope( 'Choose files…' );
		expect( await screen.findByRole( 'checkbox', { name: 'style.css' } ) ).toBeChecked();
		fireEvent.click( screen.getByRole( 'button', { name: 'Done' } ) );
		fireEvent.click( screen.getByRole( 'button', { name: 'Publish…' } ) );
		await waitFor( () =>
			expect( screen.queryByRole( 'button', { name: 'Publish' } ) ).not.toBeInTheDocument()
		);
		fireEvent.click( screen.getByRole( 'button', { name: 'Publish…' } ) );
		const publish = await screen.findByRole( 'button', { name: 'Publish' } );
		await waitFor( () => expect( publish ).toBeEnabled() );
		fireEvent.click( publish );
		await waitFor( () =>
			expect( connector.pushSiteToLive ).toHaveBeenCalledWith( site.id, 42, {
				optionsToSync: [ 'themes' ],
				specificSelectionPaths: [ 'themes/site/style.css' ],
			} )
		);
	} );

	it( 'keeps expanded files mounted while a changed selection is being checked', async () => {
		const { connector, ready } = setup( [ remote ] );
		connector.listLocalFileTree.mockResolvedValue( [
			{
				name: 'uploads',
				path: 'wp-content/uploads',
				isDirectory: true,
				children: [
					{ name: 'hero.jpg', path: 'wp-content/uploads/hero.jpg', isDirectory: false },
					{ name: 'cover.jpg', path: 'wp-content/uploads/cover.jpg', isDirectory: false },
				],
			},
		] );
		let finishSize: ( size: number ) => void = () => {};
		connector.getFileSize.mockImplementation(
			() =>
				new Promise( ( resolve ) => {
					finishSize = resolve;
				} )
		);
		await ready;
		await selectScope( 'Choose files…' );
		fireEvent.click( await screen.findByRole( 'button', { name: 'Expand uploads' } ) );
		fireEvent.click( await screen.findByText( 'hero.jpg', { exact: true } ) );
		await waitFor( () => expect( connector.getFileSize ).toHaveBeenCalled() );
		expect( screen.getByRole( 'button', { name: 'Collapse uploads' } ) ).toBeVisible();
		expect( screen.getByRole( 'checkbox', { name: 'hero.jpg' } ) ).toBeChecked();
		await act( async () => finishSize( 1024 ) );
		await waitFor( () =>
			expect( screen.queryByText( 'Preparing transfer options…' ) ).not.toBeInTheDocument()
		);
	} );

	it( 'keeps CLI progress visible after dismissal and disables cancellation during application', async () => {
		const { connector, emit, ready } = setup( [ remote ] );
		connector.pushSiteToLive.mockImplementation( () => new Promise( () => {} ) );
		await ready;
		const publish = await screen.findByRole( 'button', { name: 'Publish' } );
		await waitFor( () => expect( publish ).toBeEnabled() );
		fireEvent.click( publish );
		emit( {
			kind: 'pending',
			direction: 'push',
			remoteSiteId: 42,
			phase: 'uploading',
			progress: 35,
		} );
		expect( screen.getByRole( 'button', { name: 'Cancel publishing' } ) ).toBeEnabled();
		expect( screen.getByRole( 'button', { name: 'Publish…' } ) ).toHaveTextContent( /^Publish$/ );
		expect( screen.getByRole( 'button', { name: 'Publish…' } ) ).toHaveAccessibleDescription(
			'Publishing…'
		);
		fireEvent.click( screen.getByRole( 'button', { name: 'Publish…' } ) );
		await waitFor( () => expect( screen.queryByRole( 'progressbar' ) ).not.toBeInTheDocument() );
		fireEvent.click( screen.getByRole( 'button', { name: 'Publish…' } ) );
		expect( await screen.findByRole( 'progressbar' ) ).toHaveAttribute( 'aria-valuenow', '35' );
		emit( { kind: 'pending', direction: 'push', remoteSiteId: 42, phase: 'applyingChanges' } );
		expect( screen.queryByRole( 'button', { name: 'Cancel publishing' } ) ).not.toBeInTheDocument();
		emit( {
			kind: 'error',
			direction: 'push',
			message: 'Check the live site before publishing again.',
		} );
		const trigger = screen.getByRole( 'button', { name: 'Publish…' } );
		expect( trigger ).toHaveTextContent( /^Publish$/ );
		expect( trigger ).toHaveAccessibleDescription( 'Check the live site before publishing again.' );
		await waitFor( () =>
			expect(
				screen.getAllByText( 'Check the live site before publishing again.' )[ 0 ]
			).toBeVisible()
		);
	} );

	it( 'keeps website management secondary and disconnects without transferring', async () => {
		const { connector, ready, site } = setup( [ remote ] );
		await ready;
		fireEvent.click( await screen.findByRole( 'button', { name: 'Website actions' } ) );
		fireEvent.click( await screen.findByRole( 'menuitem', { name: 'Manage websites…' } ) );
		expect( screen.queryByRole( 'button', { name: 'Publish' } ) ).not.toBeInTheDocument();
		fireEvent.click( await screen.findByRole( 'button', { name: 'Disconnect' } ) );
		await waitFor( () =>
			expect( connector.disconnectWpcomSite ).toHaveBeenCalledWith( site.id, 42 )
		);
	} );

	it( 'disables network actions while offline', async () => {
		const { ready } = setup( [ remote ] );
		await ready;
		await screen.findByRole( 'button', { name: 'Publish' } );
		vi.spyOn( navigator, 'onLine', 'get' ).mockReturnValue( false );
		act( () => {
			fireEvent( window, new Event( 'offline' ) );
		} );
		expect( screen.getByRole( 'button', { name: 'Publish' } ) ).toBeDisabled();
		expect(
			screen.getByText( 'Connect to the internet to publish or pull changes.' )
		).toBeVisible();
	} );

	it( 'offers to start the site rather than repeating an already-applied pull', async () => {
		const { connector, emit, ready, site } = setup( [ remote ], true, false );
		await ready;
		await openPull();
		emit( { kind: 'pending', direction: 'pull', remoteSiteId: 42 } );
		emit( {
			kind: 'error',
			direction: 'pull',
			message: 'Could not start PHP',
			localChangesApplied: true,
		} );
		await screen.findByText( /Couldn’t restart the site/ );
		expect( screen.queryByRole( 'button', { name: 'Try pulling again' } ) ).not.toBeInTheDocument();
		fireEvent.click( screen.getByRole( 'button', { name: 'Start site' } ) );
		await waitFor( () => expect( connector.startSite ).toHaveBeenCalledWith( site.id ) );
		expect( connector.pullSiteFromLive ).not.toHaveBeenCalled();
	} );

	it( 'blocks publishing when administrator access has been lost', async () => {
		const { connector, queryClient, ready } = setup( [ remote ] );
		await ready;
		await screen.findByRole( 'button', { name: 'Publish' } );
		connector.fetchSyncableWpcomSites.mockResolvedValue( [
			{ ...remote, syncSupport: 'missing-permissions' },
		] );
		await act( async () => {
			await queryClient.invalidateQueries();
		} );
		expect(
			await screen.findByText( 'You need administrator access to publish or pull changes.' )
		).toBeVisible();
		expect( screen.getByRole( 'button', { name: 'Publish' } ) ).toBeDisabled();
	} );

	it( 'disables publishing to a website the account can no longer reach', async () => {
		const { connector, ready } = setup( [ remote ] );
		connector.fetchSyncableWpcomSites.mockResolvedValue( [] );
		await ready;
		expect(
			await screen.findByText(
				'This website is no longer available to this account. Choose another website.'
			)
		).toBeVisible();
		expect( screen.getByRole( 'button', { name: 'Publish' } ) ).toBeDisabled();
	} );

	it( 'marks symbolic links and publishes only the files picked', async () => {
		const { connector, ready, site } = setup( [ remote ] );
		connector.listLocalFileTree.mockResolvedValue( [
			{
				name: 'plugins',
				isDirectory: true,
				path: 'wp-content/plugins',
				children: [
					{ name: 'akismet', isDirectory: true, path: 'wp-content/plugins/akismet' },
					{ name: 'shared', isDirectory: true, isSymlink: true, path: 'wp-content/plugins/shared' },
				],
			},
		] );
		await ready;
		await selectScope( 'Choose files…' );
		fireEvent.click( await screen.findByRole( 'button', { name: 'Expand plugins' } ) );
		fireEvent.click( screen.getByRole( 'checkbox', { name: 'shared (symbolic link)' } ) );
		fireEvent.click( screen.getByRole( 'button', { name: 'Done' } ) );
		const publish = await screen.findByRole( 'button', { name: 'Publish' } );
		await waitFor( () => expect( publish ).toBeEnabled() );
		fireEvent.click( publish );
		await waitFor( () =>
			expect( connector.pushSiteToLive ).toHaveBeenCalledWith( site.id, 42, {
				optionsToSync: [ 'plugins' ],
				specificSelectionPaths: [ 'plugins/shared' ],
			} )
		);
	} );

	it( 'lets a site connected in Add site retry the first pull that failed', async () => {
		const { connector, emit, site } = setup( [ remote ] );
		connector.getLatestRewindId.mockResolvedValue( 'rewind-1' );
		await screen.findByRole( 'button', { name: 'Publish…' } );
		act( () => requestHeaderPanel( { panel: 'publish', siteId: site.id, view: 'pull' } ) );
		emit( { kind: 'pending', direction: 'pull', remoteSiteId: 42 } );
		emit( { kind: 'error', direction: 'pull', message: 'Backup failed' } );
		expect(
			await screen.findByText(
				'Your local site is saved. Retry to finish bringing in its content.'
			)
		).toBeVisible();
		const retry = await screen.findByRole( 'button', { name: 'Try pulling again' } );
		await waitFor( () => expect( retry ).toBeEnabled() );
		fireEvent.click( retry );
		await waitFor( () =>
			expect( connector.pullSiteFromLive ).toHaveBeenCalledWith( site.id, 42, {
				optionsToSync: [ 'all' ],
			} )
		);
	} );

	it( 'publishes once when the checkout callback arrives twice', async () => {
		const { connector, completeSetup } = setup();
		await screen.findByRole( 'button', { name: 'Publish…' } );
		await completeSetup();
		await completeSetup();
		await waitFor( () => expect( connector.pushSiteToLive ).toHaveBeenCalled() );
		expect( connector.connectWpcomSite ).toHaveBeenCalledTimes( 1 );
		expect( connector.pushSiteToLive ).toHaveBeenCalledTimes( 1 );
	} );

	it( 'keeps a site over the size limit from publishing after checkout', async () => {
		const { connector, completeSetup, ready } = setup();
		connector.getDirectorySize.mockResolvedValue( Number.MAX_SAFE_INTEGER );
		await completeSetup();
		await ready;
		expect( await screen.findByText( /exceeds the .* GB publishing limit/ ) ).toBeVisible();
		await waitFor( () => expect( connector.connectWpcomSite ).toHaveBeenCalled() );
		expect( connector.pushSiteToLive ).not.toHaveBeenCalled();
	} );

	it( 'retries a delayed setup callback without opening another setup', async () => {
		const { connector, completeSetup, ready } = setup();
		await ready;
		fireEvent.click( await screen.findByRole( 'button', { name: 'Publish on WordPress.com' } ) );
		await screen.findByText( 'Waiting for WordPress.com…' );
		connector.fetchSyncableWpcomSites.mockRejectedValueOnce( new Error( 'Website not ready' ) );
		await completeSetup( true );
		await waitFor( () =>
			expect( screen.getByRole( 'button', { name: 'Publish…' } ) ).toHaveAccessibleDescription(
				'Website not ready'
			)
		);
		fireEvent.click( await screen.findByRole( 'button', { name: 'Try again' } ) );
		await waitFor( () => expect( connector.pushSiteToLive ).toHaveBeenCalledTimes( 1 ) );
		expect( connector.openExternalUrl ).toHaveBeenCalledTimes( 1 );
		expect( screen.getByRole( 'button', { name: 'Publish…' } ) ).not.toHaveAccessibleDescription(
			'Website not ready'
		);
	} );

	it( 'uses the destination of a CLI transfer without showing an old include selection', async () => {
		const staging = {
			...remote,
			id: 43,
			name: 'Staging',
			isStaging: true,
			url: 'https://staging.example.com',
		};
		const { emit, ready } = setup( [ remote, staging ] );
		await ready;
		await selectScope( 'Files only' );
		emit( { kind: 'pending', direction: 'pull', remoteSiteId: 43, message: 'Downloading…' } );
		await screen.findByText( 'staging.example.com' );
		expect( screen.queryByText( 'Files only' ) ).not.toBeInTheDocument();
		expect( screen.queryByText( 'example.com' ) ).not.toBeInTheDocument();
	} );

	it( 'can start a new website from secondary website management', async () => {
		const { connector, ready } = setup( [ remote ] );
		await ready;
		fireEvent.click( await screen.findByRole( 'button', { name: 'Website actions' } ) );
		fireEvent.click( await screen.findByRole( 'menuitem', { name: 'Manage websites…' } ) );
		fireEvent.click(
			await screen.findByRole( 'button', { name: 'Create a new WordPress.com site' } )
		);
		await screen.findByText( 'Waiting for WordPress.com…' );
		expect( connector.openExternalUrl ).toHaveBeenCalledTimes( 1 );
	} );

	it( 'publishes to the website selected from multiple destinations', async () => {
		const staging = {
			...remote,
			id: 43,
			name: 'Staging',
			isStaging: true,
			url: 'https://staging.example.com',
		};
		const { connector, ready, site } = setup( [ remote, staging ] );
		await ready;
		const websites = await screen.findByRole( 'combobox', { name: 'Website' } );
		fireEvent.click( websites );
		const option = await screen.findByRole( 'option', { name: /staging\.example\.com.*Staging/ } );
		fireEvent.pointerDown( option, { pointerType: 'mouse' } );
		fireEvent.click( option );
		const publish = await screen.findByRole( 'button', { name: 'Publish' } );
		await waitFor( () => expect( publish ).toBeEnabled() );
		fireEvent.click( publish );
		await waitFor( () =>
			expect( connector.pushSiteToLive ).toHaveBeenCalledWith( site.id, 43, {
				optionsToSync: [ 'all' ],
			} )
		);
	} );
} );

it( 'opens the requested publishing screen for the requested destination without starting a transfer', async () => {
	const other = { ...remote, id: 43, url: 'https://other.example.com' };
	const { connector, ready, site } = setup( [ remote, other ] );
	await ready;
	await screen.findByRole( 'combobox', { name: 'What to publish' } );
	act( () =>
		requestHeaderPanel( { panel: 'publish', siteId: site.id, view: 'pull', remoteSiteId: 43 } )
	);
	const pull = await screen.findByRole( 'button', { name: 'Pull changes' } );
	await waitFor( () => expect( pull ).toBeEnabled() );
	expect( screen.getByText( 'other.example.com' ) ).toBeVisible();
	expect( connector.pullSiteFromLive ).not.toHaveBeenCalled();
	expect( connector.pushSiteToLive ).not.toHaveBeenCalled();
	fireEvent.click( pull );
	await waitFor( () =>
		expect( connector.pullSiteFromLive ).toHaveBeenCalledWith( site.id, 43, {
			optionsToSync: [ 'all' ],
		} )
	);
	await screen.findByText( 'Changes pulled into WordPress Studio', {}, { timeout: 3000 } );
	act( () =>
		requestHeaderPanel( { panel: 'publish', siteId: site.id, view: 'websites', remoteSiteId: 43 } )
	);
	await screen.findByRole( 'dialog', { name: 'Websites' } );
	act( () =>
		requestHeaderPanel( { panel: 'publish', siteId: site.id, view: 'publish', remoteSiteId: 42 } )
	);
	await screen.findByRole( 'combobox', { name: 'What to publish' } );
	expect( screen.getByRole( 'combobox', { name: 'Website' } ) ).toHaveTextContent( 'example.com' );
} );
