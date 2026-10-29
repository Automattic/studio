import { onlineManager } from '@tanstack/react-query';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useSyncExternalStore } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getNoticeHistory, resetAppMessagesForTests } from '@/data/app-messages';
import { requestHeaderPanel } from '@/data/use-open-header-panel';
import { SessionUIProvider } from '@/data/use-session-ui';
import { PublishButton, SiteDeliveryDialog } from '@/features/site-delivery';
import { createFakeConnector, makeSite, TEST_USER } from '@/test/fake-connector';
import { renderWithProviders } from '@/test/render';
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

function setup( connections: SyncSite[] = [], signedIn = true, running = true, review = true ) {
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
				connected = [ ...connected.filter( ( item ) => item.id !== target.id ), target ];
			},
			disconnectWpcomSite: async ( _, remoteSiteId ) => {
				connected = connected.filter( ( item ) => item.id !== remoteSiteId );
			},
			getPublishCheckoutUrl: () => 'https://wordpress.com/setup/new-hosted-site',
			getHostingPhpVersion: async () => '8.3',
		}
	);
	const visibility = createVisibility();
	function Harness() {
		const visible = useSyncExternalStore( visibility.subscribe, visibility.get );
		return visible ? (
			<>
				<SiteDeliveryDialog site={ site } />
				<PublishButton site={ site } />
			</>
		) : null;
	}
	const view = renderWithProviders(
		<SessionUIProvider>
			<Harness />
		</SessionUIProvider>,
		{ connector }
	);
	const ready = screen.findByRole( 'button', { name: 'Publish…' } ).then( async ( button ) => {
		fireEvent.click( button );
		if ( connections.length && review ) {
			fireEvent.click( await screen.findByRole( 'button', { name: 'Publish changes' } ) );
			await screen.findByRole( 'radiogroup', { name: 'What to publish' } );
		}
	} );
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
	const cancel = screen.queryByRole( 'button', { name: 'Cancel' } );
	if ( cancel ) fireEvent.click( cancel );
	fireEvent.click( await screen.findByRole( 'button', { name: 'Pull changes' } ) );
	await screen.findByRole( 'radiogroup', { name: 'What to pull' } );
}

async function selectScope( name: string, pull = false ) {
	const control = await screen.findByRole( 'radiogroup', {
		name: pull ? 'What to pull' : 'What to publish',
	} );
	await waitFor( () => expect( control ).toBeEnabled() );
	fireEvent.click(
		within( control ).getByRole( 'radio', {
			name: name === 'Files, content, and settings' ? 'Entire site' : name,
		} )
	);
}

beforeEach( () => {
	resetAppMessagesForTests();
	vi.spyOn( navigator, 'onLine', 'get' ).mockReturnValue( true );
	onlineManager.setOnline( true );
} );

describe( 'PublishPopover', () => {
	it( 'shows only the loading state until connected destinations are ready', async () => {
		const { connector, ready } = setup( [ remote ], true, true, false );
		let finish!: ( sites: SyncSite[] ) => void;
		connector.getConnectedWpcomSites.mockImplementationOnce(
			() =>
				new Promise( ( resolve ) => {
					finish = resolve;
				} )
		);
		await ready;
		expect( await screen.findByRole( 'status', { name: 'Loading…' } ) ).toBeVisible();
		expect(
			screen.queryByRole( 'heading', { name: 'Publish your WordPress' } )
		).not.toBeInTheDocument();
		await act( async () => finish( [ remote ] ) );
		expect( await screen.findByRole( 'button', { name: 'Pull changes' } ) ).toBeVisible();
		expect(
			screen.queryByRole( 'heading', { name: 'Publish your WordPress' } )
		).not.toBeInTheDocument();
	} );

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
		expect( screen.queryByRole( 'tablist' ) ).not.toBeInTheDocument();
		expect(
			screen.queryByText(
				'Publish to a new site and choose a domain, or use an existing site on WordPress.com or Pressable.'
			)
		).not.toBeInTheDocument();
		expect( screen.queryByRole( 'button', { name: 'Learn more…' } ) ).not.toBeInTheDocument();
		expect( screen.queryByRole( 'button', { name: 'Existing site…' } ) ).not.toBeInTheDocument();
		fireEvent.click( screen.getByRole( 'button', { name: 'Log in' } ) );
		await waitFor( () =>
			expect( connector.authenticate ).toHaveBeenCalledWith( false, 'sync_tab' )
		);
		await waitFor( () => expect( connector.fetchSyncableWpcomSites ).toHaveBeenCalled() );
	} );

	it( 'returns login to the site’s publishing state', async () => {
		const { connector, ready } = setup( [], false );
		await ready;
		await screen.findByRole( 'dialog', { name: 'Publish your WordPress' } );
		fireEvent.click( screen.getByRole( 'button', { name: 'Log in' } ) );
		await screen.findByRole( 'button', { name: 'New site…' } );
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
		const { connector, completeSetup, hide, ready } = setup();
		await ready;
		fireEvent.click( await screen.findByRole( 'button', { name: 'New site…' } ) );
		await waitFor( () => expect( connector.openExternalUrl ).toHaveBeenCalledTimes( 1 ) );
		hide();
		await completeSetup( true );
		await waitFor( () => expect( connector.connectWpcomSite ).toHaveBeenCalled() );
		expect( connector.pushSiteToLive ).not.toHaveBeenCalled();
	} );

	it( 'reviews publishing and pulling in the same dialog with back navigation', async () => {
		const { connector, ready } = setup( [ remote ], true, true, false );
		await ready;
		expect( await screen.findByRole( 'button', { name: 'Pull changes' } ) ).toBeVisible();
		fireEvent.click( screen.getByRole( 'button', { name: 'Publish changes' } ) );
		await screen.findByRole( 'radiogroup', { name: 'What to publish' } );
		const confirmation = screen.getByRole( 'dialog', { name: 'Share and publish' } );
		expect( screen.queryByRole( 'alertdialog' ) ).not.toBeInTheDocument();
		expect( screen.getAllByRole( 'dialog' ) ).toHaveLength( 1 );
		expect(
			within( confirmation ).getByRole( 'heading', { name: 'Publish changes' } )
		).toBeVisible();
		expect( screen.queryByRole( 'tab', { name: 'Publish' } ) ).not.toBeInTheDocument();
		expect( within( confirmation ).getByRole( 'radio', { name: 'Entire site' } ) ).toBeChecked();
		fireEvent.click( screen.getByRole( 'button', { name: 'Back to Publish' } ) );
		expect( screen.getByRole( 'dialog', { name: 'Share and publish' } ) ).toBe( confirmation );
		expect( screen.getByRole( 'tab', { name: 'Publish' } ) ).toBeVisible();
		fireEvent.click( screen.getByRole( 'button', { name: 'Pull changes' } ) );
		await screen.findByRole( 'radiogroup', { name: 'What to pull' } );
		expect( screen.getAllByRole( 'dialog' ) ).toHaveLength( 1 );
		expect( screen.queryByRole( 'alertdialog' ) ).not.toBeInTheDocument();
		fireEvent.click( screen.getByRole( 'button', { name: 'Back to Publish' } ) );
		await waitFor( () =>
			expect( screen.getByRole( 'button', { name: 'Pull changes' } ) ).toHaveFocus()
		);
		expect( connector.pushSiteToLive ).not.toHaveBeenCalled();
		expect( connector.pullSiteFromLive ).not.toHaveBeenCalled();
	} );

	it( 'copies the connected site link from its actions menu', async () => {
		const { connector, ready } = setup( [ remote ], true, true, false );
		await ready;
		fireEvent.click( await screen.findByRole( 'button', { name: 'Website actions' } ) );
		fireEvent.click( await screen.findByRole( 'menuitem', { name: 'Copy link' } ) );
		await waitFor( () => expect( connector.copyText ).toHaveBeenCalledWith( remote.url ) );
		expect( await screen.findByText( 'Copied' ) ).toBeInTheDocument();
	} );

	it( 'shows the address, environment, relative publish time and existing hosting links', async () => {
		const published = {
			...remote,
			isStaging: true,
			lastPushTimestamp: new Date( Date.now() - 3 * 60 * 60 * 1000 ).toISOString(),
		};
		const { connector, ready } = setup( [ published ], true, true, false );
		connector.fetchSyncableWpcomSites.mockResolvedValue( [ published ] );
		await ready;
		const card = await screen.findByRole( 'group', { name: 'Website' } );
		expect( within( card ).getByText( 'example.com' ) ).toBeVisible();
		expect( within( card ).getByText( 'Staging' ) ).toBeVisible();
		expect( within( card ).getByText( 'Updated 3h ago' ) ).toBeVisible();
		fireEvent.click( within( card ).getByRole( 'button', { name: 'Domains' } ) );
		expect( connector.openExternalUrl ).toHaveBeenLastCalledWith(
			'https://my.wordpress.com/sites/example.com/domains'
		);
		fireEvent.click( within( card ).getByRole( 'button', { name: 'Manage on WordPress.com' } ) );
		expect( connector.openExternalUrl ).toHaveBeenLastCalledWith(
			'https://my.wordpress.com/sites/example.com'
		);
		fireEvent.click( within( card ).getByRole( 'button', { name: 'Backups' } ) );
		expect( connector.openExternalUrl ).toHaveBeenLastCalledWith(
			'https://wordpress.com/backup/example.com'
		);
	} );

	it( 'shows Pressable development without offering WordPress.com management links', async () => {
		const pressable = { ...remote, isPressable: true, environmentType: 'development' };
		const { connector, ready } = setup( [ pressable ], true, true, false );
		connector.fetchSyncableWpcomSites.mockResolvedValue( [ pressable ] );
		await ready;
		const card = await screen.findByRole( 'group', { name: 'Website' } );
		expect( within( card ).getByText( 'Development' ) ).toBeVisible();
		expect( within( card ).queryByRole( 'button', { name: 'Domains' } ) ).not.toBeInTheDocument();
		expect(
			within( card ).queryByRole( 'button', { name: 'Manage on WordPress.com' } )
		).not.toBeInTheDocument();
		expect( within( card ).queryByRole( 'button', { name: 'Backups' } ) ).not.toBeInTheDocument();
	} );

	it( 'returns to the connected site after publishing succeeds', async () => {
		const { emit, ready } = setup( [ remote ] );
		await ready;
		emit( { kind: 'pending', direction: 'push', remoteSiteId: 42 } );
		emit( { kind: 'success', direction: 'push' } );
		expect( await screen.findByRole( 'button', { name: 'Pull changes' } ) ).toBeVisible();
		expect( screen.queryByRole( 'button', { name: /Back to/ } ) ).not.toBeInTheDocument();
	} );

	it( 'allows another pull immediately after dismissing a successful pull', async () => {
		const { connector, ready } = setup( [ remote ], true, true, false );
		await ready;
		await openPull();
		const first = within( screen.getByRole( 'dialog', { name: 'Share and publish' } ) ).getByRole(
			'button',
			{
				name: 'Pull changes',
			}
		);
		await waitFor( () => expect( first ).toBeEnabled() );
		fireEvent.click( first );
		await screen.findByText( 'Changes pulled into WordPress Studio' );
		fireEvent.click( screen.getByRole( 'button', { name: 'Done' } ) );
		await openPull();
		expect( screen.queryByRole( 'button', { name: 'Done' } ) ).not.toBeInTheDocument();
		const confirm = within( screen.getByRole( 'dialog', { name: 'Share and publish' } ) ).getByRole(
			'button',
			{
				name: 'Pull changes',
			}
		);
		await waitFor( () => expect( confirm ).toBeEnabled() );
		fireEvent.click( confirm );
		await waitFor( () => expect( connector.pullSiteFromLive ).toHaveBeenCalledTimes( 2 ) );
	} );

	it( 'connects an eligible Pressable website without starting a transfer', async () => {
		const { connector, ready, site } = setup();
		connector.fetchSyncableWpcomSites.mockResolvedValue( [ { ...remote, isPressable: true } ] );
		await ready;
		fireEvent.click( await screen.findByRole( 'button', { name: 'Existing site…' } ) );
		fireEvent.click( await screen.findByRole( 'option', { name: /Hosted site.*example.com/ } ) );
		await screen.findByRole( 'button', { name: 'Pull changes' } );
		expect( connector.connectWpcomSite ).toHaveBeenCalledWith(
			site.id,
			expect.objectContaining( { id: 42, isPressable: true } )
		);
		expect( connector.pushSiteToLive ).not.toHaveBeenCalled();
	} );

	it.each( [ 'none', 'ineligible', 'connected elsewhere' ] )(
		'refreshes websites when %s are available',
		async ( state ) => {
			const { connector, ready } = setup();
			connector.fetchSyncableWpcomSites.mockResolvedValue(
				state === 'none'
					? []
					: [ { ...remote, syncSupport: state === 'ineligible' ? 'needs-upgrade' : 'syncable' } ]
			);
			if ( state === 'connected elsewhere' ) {
				connector.getConnectedWpcomSites.mockImplementation( async ( siteId ) =>
					siteId ? [] : [ remote ]
				);
			}
			await ready;
			fireEvent.click( await screen.findByRole( 'button', { name: 'Existing site…' } ) );
			const refresh = await screen.findByRole( 'button', { name: 'Refresh' } );
			expect( screen.getByText( 'No existing sites.' ) ).toBeVisible();
			expect( screen.queryByRole( 'button', { name: 'Existing site…' } ) ).not.toBeInTheDocument();
			connector.fetchSyncableWpcomSites.mockResolvedValue( [ remote ] );
			connector.getConnectedWpcomSites.mockResolvedValue( [] );
			fireEvent.click( refresh );
			await screen.findByRole( 'option', { name: /Hosted site.*example.com/ } );
			expect( connector.pushSiteToLive ).not.toHaveBeenCalled();
			expect( connector.openExternalUrl ).not.toHaveBeenCalled();
		}
	);

	it( 'retries website discovery without treating an error as an empty account', async () => {
		const { connector, ready } = setup();
		connector.fetchSyncableWpcomSites.mockRejectedValue( new Error( 'Could not load websites' ) );
		await ready;
		fireEvent.click( await screen.findByRole( 'button', { name: 'Existing site…' } ) );
		await screen.findByText( 'Could not load websites' );
		expect( screen.queryByText( /No existing sites/ ) ).not.toBeInTheDocument();
		connector.fetchSyncableWpcomSites.mockResolvedValue( [ remote ] );
		fireEvent.click( screen.getByRole( 'button', { name: 'Try again' } ) );
		await screen.findByRole( 'option', { name: /Hosted site.*example.com/ } );
	} );

	it( 'chooses an existing site within the dialog and supports back navigation without publishing', async () => {
		const { connector, ready } = setup();
		await ready;
		const panel = await screen.findByRole( 'dialog', { name: 'Share and publish' } );
		fireEvent.click( await screen.findByRole( 'button', { name: 'Existing site…' } ) );
		await screen.findByRole( 'heading', { name: 'Choose an existing site' } );
		expect( screen.queryByRole( 'tablist' ) ).not.toBeInTheDocument();
		expect( screen.queryByRole( 'button', { name: 'Refresh' } ) ).not.toBeInTheDocument();
		fireEvent.click( await screen.findByRole( 'button', { name: 'Site actions' } ) );
		fireEvent.click( await screen.findByRole( 'menuitem', { name: 'Refresh' } ) );
		expect( screen.queryByRole( 'menu' ) ).not.toBeInTheDocument();
		fireEvent.click( screen.getByRole( 'button', { name: 'Back to Publish' } ) );
		expect( screen.getByRole( 'button', { name: 'New site…' } ) ).toBeVisible();
		fireEvent.click( screen.getByRole( 'button', { name: 'Existing site…' } ) );
		fireEvent.click( await screen.findByRole( 'option', { name: /Hosted site.*example.com/ } ) );
		await screen.findByRole( 'button', { name: 'Pull changes' } );
		expect( screen.getByRole( 'dialog', { name: 'Share and publish' } ) ).toBe( panel );
		expect( screen.queryByRole( 'button', { name: /Back to/ } ) ).not.toBeInTheDocument();
		expect( connector.pushSiteToLive ).not.toHaveBeenCalled();
		expect( connector.openExternalUrl ).not.toHaveBeenCalled();
	} );

	it( 'opens the selected website without publishing', async () => {
		const { connector, ready } = setup( [ remote ], true, true, false );
		await ready;
		fireEvent.click( await screen.findByRole( 'button', { name: 'Website actions' } ) );
		fireEvent.click( await screen.findByRole( 'menuitem', { name: 'Visit site' } ) );
		expect( connector.openExternalUrl ).toHaveBeenCalledWith( remote.url );
		expect( connector.pushSiteToLive ).not.toHaveBeenCalled();
	} );

	it( 'can reopen new-site setup or choose an existing site while waiting for checkout', async () => {
		const { connector, ready } = setup();
		await ready;
		const checkout = await screen.findByRole( 'button', { name: 'New site…' } );
		fireEvent.click( checkout );
		await waitFor( () => expect( connector.openExternalUrl ).toHaveBeenCalledTimes( 1 ) );
		expect( checkout ).toBeEnabled();
		fireEvent.click( checkout );
		await waitFor( () => expect( connector.openExternalUrl ).toHaveBeenCalledTimes( 2 ) );
		expect( connector.openExternalUrl ).toHaveBeenLastCalledWith(
			'https://wordpress.com/setup/new-hosted-site'
		);
		const existing = screen.getByRole( 'button', { name: 'Existing site…' } );
		expect( existing ).toBeEnabled();
		fireEvent.click( existing );
		fireEvent.click( await screen.findByRole( 'option', { name: /Hosted site.*example.com/ } ) );
		await screen.findByRole( 'button', { name: 'Pull changes' } );
		expect( connector.connectWpcomSite ).toHaveBeenCalled();
		expect( connector.pushSiteToLive ).not.toHaveBeenCalled();
	} );

	it( 'keeps the overwrite warning for websites already published to', async () => {
		const { ready } = setup( [ { ...remote, lastPushTimestamp: '2026-10-26T12:00:00Z' } ] );
		await ready;
		expect(
			await screen.findByText(
				'Selected files, content, and settings on your website will be overwritten.'
			)
		).toBeVisible();
	} );

	it( 'publishes immediately with the inline files preset', async () => {
		const { connector, ready, site } = setup( [ remote ] );
		await ready;
		await selectScope( 'Files only' );
		const publish = await screen.findByRole( 'button', { name: 'Publish changes' } );
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
			expect( screen.getByRole( 'radiogroup', { name: 'What to pull' } ) ).toBeDisabled()
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

	it( 'keeps publish and pull scopes independent with stable overwrite explanations', async () => {
		const { connector, ready } = setup( [ remote ] );
		connector.getLatestRewindId.mockResolvedValue( 'backup-1' );
		await ready;
		const description = await screen.findByText(
			'Selected files, content, and settings on your website will be overwritten.'
		);
		await selectScope( 'Files only' );
		expect( description ).toHaveTextContent(
			'Selected files, content, and settings on your website will be overwritten.'
		);
		await openPull();
		await selectScope( 'Content and settings only', true );
		expect(
			await screen.findByText(
				'Selected files, content, and settings in WordPress Studio will be overwritten. Your website stays unchanged.'
			)
		).toBeVisible();
		fireEvent.click( screen.getByRole( 'button', { name: 'Cancel' } ) );
		fireEvent.click( screen.getByRole( 'button', { name: 'Publish changes' } ) );
		expect( screen.getByRole( 'radio', { name: 'Files only' } ) ).toBeChecked();
		await openPull();
		expect( screen.getByRole( 'radio', { name: 'Content and settings only' } ) ).toBeChecked();
	} );

	it( 'retains granular file selection behind the inline control', async () => {
		const { connector, ready, site } = setup( [ remote ] );
		connector.listLocalFileTree.mockResolvedValue( [
			{ name: 'style.css', path: 'wp-content/themes/site/style.css', isDirectory: false },
		] );
		await ready;
		await selectScope( 'Choose files…' );
		fireEvent.click( await screen.findByRole( 'checkbox', { name: 'style.css' } ) );
		await selectScope( 'Files only' );
		await selectScope( 'Choose files…' );
		expect( await screen.findByRole( 'checkbox', { name: 'style.css' } ) ).toBeChecked();
		fireEvent.click( screen.getByRole( 'button', { name: 'Close' } ) );
		await waitFor( () => expect( screen.queryByRole( 'alertdialog' ) ).not.toBeInTheDocument() );
		fireEvent.click( screen.getAllByRole( 'button', { name: 'Publish…', hidden: true } )[ 0 ] );
		fireEvent.click( await screen.findByRole( 'button', { name: 'Publish changes' } ) );
		const publish = await screen.findByRole( 'button', { name: 'Publish changes' } );
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
		const publish = await screen.findByRole( 'button', { name: 'Publish changes' } );
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
		expect(
			screen.getAllByRole( 'button', { name: 'Publish…', hidden: true } )[ 0 ]
		).toHaveTextContent( /^Publish$/ );
		expect(
			screen.getAllByRole( 'button', { name: 'Publish…', hidden: true } )[ 0 ]
		).toHaveAccessibleDescription( 'Publishing…' );
		fireEvent.click( screen.getByRole( 'button', { name: 'Close' } ) );
		await waitFor( () => expect( screen.queryByRole( 'progressbar' ) ).not.toBeInTheDocument() );
		fireEvent.click( screen.getAllByRole( 'button', { name: 'Publish…', hidden: true } )[ 0 ] );
		expect( await screen.findByRole( 'progressbar' ) ).toHaveAttribute( 'aria-valuenow', '35' );
		emit( { kind: 'pending', direction: 'push', remoteSiteId: 42, phase: 'applyingChanges' } );
		expect( screen.queryByRole( 'button', { name: 'Cancel publishing' } ) ).not.toBeInTheDocument();
		emit( {
			kind: 'error',
			direction: 'push',
			message: 'Check the live site before publishing again.',
		} );
		const trigger = screen.getAllByRole( 'button', { name: 'Publish…', hidden: true } )[ 0 ];
		expect( trigger ).toHaveTextContent( /^Publish$/ );
		expect( trigger ).toHaveAccessibleDescription( 'Check the live site before publishing again.' );
		await waitFor( () =>
			expect(
				screen.getAllByText( 'Check the live site before publishing again.' )[ 0 ]
			).toBeVisible()
		);
	} );

	it( 'confirms disconnection and returns to the existing-site picker without transferring', async () => {
		const { connector, ready, site } = setup( [ remote ], true, true, false );
		await ready;
		expect( screen.queryByRole( 'button', { name: 'Website' } ) ).not.toBeInTheDocument();
		fireEvent.click( await screen.findByRole( 'button', { name: 'Website actions' } ) );
		fireEvent.click( await screen.findByRole( 'menuitem', { name: 'Disconnect…' } ) );
		let confirmation = await screen.findByRole( 'alertdialog', { name: 'Disconnect website?' } );
		expect( within( confirmation ).getByText( 'example.com' ) ).toBeVisible();
		await waitFor( () =>
			expect( within( confirmation ).getByRole( 'button', { name: 'Cancel' } ) ).toHaveFocus()
		);
		expect( connector.disconnectWpcomSite ).not.toHaveBeenCalled();
		fireEvent.click( within( confirmation ).getByRole( 'button', { name: 'Cancel' } ) );
		await waitFor( () => expect( screen.queryByRole( 'alertdialog' ) ).not.toBeInTheDocument() );
		expect( connector.disconnectWpcomSite ).not.toHaveBeenCalled();
		fireEvent.click( await screen.findByRole( 'button', { name: 'Website actions' } ) );
		fireEvent.click( await screen.findByRole( 'menuitem', { name: 'Disconnect…' } ) );
		confirmation = await screen.findByRole( 'alertdialog' );
		fireEvent.click( within( confirmation ).getByRole( 'button', { name: 'Disconnect' } ) );
		await waitFor( () =>
			expect( connector.disconnectWpcomSite ).toHaveBeenCalledWith( site.id, 42 )
		);
		expect(
			await screen.findByRole( 'heading', { name: 'Choose an existing site' } )
		).toBeVisible();
		expect( connector.pushSiteToLive ).not.toHaveBeenCalled();
		expect( connector.pullSiteFromLive ).not.toHaveBeenCalled();
	} );

	it( 'keeps the confirmation open when disconnecting fails and allows retrying', async () => {
		const { connector, ready } = setup( [ remote ], true, true, false );
		await ready;
		connector.disconnectWpcomSite.mockRejectedValueOnce( new Error( 'Could not disconnect' ) );
		fireEvent.click( await screen.findByRole( 'button', { name: 'Website actions' } ) );
		fireEvent.click( await screen.findByRole( 'menuitem', { name: 'Disconnect…' } ) );
		const confirmation = await screen.findByRole( 'alertdialog' );
		fireEvent.click( within( confirmation ).getByRole( 'button', { name: 'Disconnect' } ) );
		expect( await within( confirmation ).findByRole( 'alert' ) ).toHaveTextContent(
			'Could not disconnect'
		);
		fireEvent.click( within( confirmation ).getByRole( 'button', { name: 'Disconnect' } ) );
		await screen.findByRole( 'heading', { name: 'Choose an existing site' } );
		expect( connector.disconnectWpcomSite ).toHaveBeenCalledTimes( 2 );
	} );

	it( 'disables network actions while offline', async () => {
		const { ready } = setup( [ remote ] );
		await ready;
		await screen.findByRole( 'button', { name: 'Publish changes' } );
		vi.spyOn( navigator, 'onLine', 'get' ).mockReturnValue( false );
		act( () => {
			fireEvent( window, new Event( 'offline' ) );
		} );
		expect( screen.getByRole( 'button', { name: 'Publish changes' } ) ).toBeDisabled();
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
		await screen.findByRole( 'button', { name: 'Publish changes' } );
		connector.fetchSyncableWpcomSites.mockResolvedValue( [
			{ ...remote, syncSupport: 'missing-permissions' },
		] );
		await act( async () => {
			await queryClient.invalidateQueries();
		} );
		expect(
			await screen.findByText( 'You need administrator access to publish or pull changes.' )
		).toBeVisible();
		expect( screen.getByRole( 'button', { name: 'Publish changes' } ) ).toBeDisabled();
	} );

	it( 'disables publishing to a website the account can no longer reach', async () => {
		const { connector, ready } = setup( [ remote ], true, true, false );
		connector.fetchSyncableWpcomSites.mockResolvedValue( [] );
		await ready;
		expect(
			await screen.findByText(
				'This website is no longer available to this account. Choose another website.'
			)
		).toBeVisible();
		expect( screen.getByRole( 'button', { name: 'Publish changes' } ) ).toBeDisabled();
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
		const publish = await screen.findByRole( 'button', { name: 'Publish changes' } );
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
		await screen.findByRole( 'button', { name: 'Publish changes' } );
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

	it( 'connects once without publishing when the checkout callback arrives twice', async () => {
		const { connector, completeSetup } = setup();
		await screen.findByRole( 'button', { name: 'Publish…' } );
		await completeSetup();
		await completeSetup();
		await waitFor( () => expect( connector.connectWpcomSite ).toHaveBeenCalledTimes( 1 ) );
		expect( connector.pushSiteToLive ).not.toHaveBeenCalled();
	} );

	it( 'keeps a site over the size limit from publishing after checkout', async () => {
		const { connector, completeSetup, ready } = setup();
		connector.getDirectorySize.mockResolvedValue( Number.MAX_SAFE_INTEGER );
		await completeSetup();
		await ready;
		fireEvent.click( await screen.findByRole( 'button', { name: 'Publish changes' } ) );
		expect( await screen.findByText( /exceeds the .* GB publishing limit/ ) ).toBeVisible();
		await waitFor( () => expect( connector.connectWpcomSite ).toHaveBeenCalled() );
		expect( connector.pushSiteToLive ).not.toHaveBeenCalled();
	} );

	it( 'retries a delayed setup callback without opening another setup', async () => {
		const { connector, completeSetup, ready } = setup();
		await ready;
		fireEvent.click( await screen.findByRole( 'button', { name: 'New site…' } ) );
		await waitFor( () => expect( connector.openExternalUrl ).toHaveBeenCalledTimes( 1 ) );
		connector.fetchSyncableWpcomSites.mockRejectedValueOnce( new Error( 'Website not ready' ) );
		await completeSetup( true );
		await waitFor( () =>
			expect(
				screen.getAllByRole( 'button', { name: 'Publish…', hidden: true } )[ 0 ]
			).toHaveAccessibleDescription( 'Website not ready' )
		);
		fireEvent.click( await screen.findByRole( 'button', { name: 'Try again' } ) );
		await waitFor( () => expect( connector.connectWpcomSite ).toHaveBeenCalledTimes( 1 ) );
		expect( connector.pushSiteToLive ).not.toHaveBeenCalled();
		expect( connector.openExternalUrl ).toHaveBeenCalledTimes( 1 );
		expect(
			screen.getAllByRole( 'button', { name: 'Publish…', hidden: true } )[ 0 ]
		).not.toHaveAccessibleDescription( 'Website not ready' );
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

	it( 'starts a new website only after explicitly disconnecting', async () => {
		const { connector, ready } = setup( [ remote ], true, true, false );
		await ready;
		fireEvent.click( await screen.findByRole( 'button', { name: 'Website actions' } ) );
		fireEvent.click( await screen.findByRole( 'menuitem', { name: 'Disconnect…' } ) );
		const confirmation = await screen.findByRole( 'alertdialog' );
		fireEvent.click( within( confirmation ).getByRole( 'button', { name: 'Disconnect' } ) );
		await screen.findByRole( 'heading', { name: 'Choose an existing site' } );
		fireEvent.click( screen.getByRole( 'button', { name: 'Back to Publish' } ) );
		fireEvent.click( screen.getByRole( 'button', { name: 'New site…' } ) );
		expect( connector.openExternalUrl ).toHaveBeenCalledTimes( 1 );
	} );

	it( 'switches the card and its links to another connected destination without connecting again', async () => {
		const actions = userEvent.setup();
		const staging = {
			...remote,
			id: 43,
			name: 'Staging',
			url: 'https://staging.example.com',
			isStaging: true,
			lastPullTimestamp: '2026-10-28T12:00:00Z',
		};
		const { connector, ready, site } = setup( [ remote, staging ], true, true, false );
		await ready;
		await actions.click(
			await screen.findByRole( 'combobox', { name: 'Switch website: example.com' } )
		);
		expect(
			await screen.findByRole( 'option', { name: /^example.com Production$/ } )
		).toHaveAttribute( 'aria-selected', 'true' );
		await actions.click( screen.getByRole( 'option', { name: /staging.example.com/ } ) );
		await waitFor( () =>
			expect(
				screen.getByRole( 'combobox', { name: 'Switch website: staging.example.com' } )
			).toHaveFocus()
		);
		const card = screen.getByRole( 'group', { name: 'Website' } );
		expect( card ).toHaveTextContent( 'staging.example.com' );
		expect( within( card ).getByText( 'Staging' ) ).toBeVisible();
		expect( within( card ).getByText( 'Last pulled' ) ).toBeVisible();
		await actions.click( within( card ).getByRole( 'button', { name: 'Backups' } ) );
		expect( connector.openExternalUrl ).toHaveBeenCalledWith(
			'https://wordpress.com/backup/staging.example.com'
		);
		expect( connector.connectWpcomSite ).not.toHaveBeenCalled();
		await actions.click( screen.getByRole( 'button', { name: 'Publish changes' } ) );
		await selectScope( 'Entire site' );
		const publish = screen.getByRole( 'button', { name: 'Publish changes' } );
		await waitFor( () => expect( publish ).toBeEnabled() );
		await actions.click( publish );
		await waitFor( () =>
			expect( connector.pushSiteToLive ).toHaveBeenCalledWith( site.id, 43, expect.anything() )
		);
	} );

	it( 'pulls from the selected connection and disconnects only that destination', async () => {
		const actions = userEvent.setup();
		const second = { ...remote, id: 43, name: 'Second site', url: 'https://second.example.com' };
		const { connector, ready, site } = setup( [ remote, second ], true, true, false );
		await ready;
		await actions.click(
			await screen.findByRole( 'combobox', { name: 'Switch website: example.com' } )
		);
		await actions.click(
			await screen.findByRole( 'option', { name: /^second.example.com Production$/ } )
		);
		await openPull();
		const pull = screen.getByRole( 'button', { name: 'Pull changes' } );
		await waitFor( () => expect( pull ).toBeEnabled() );
		await actions.click( pull );
		await waitFor( () =>
			expect( connector.pullSiteFromLive ).toHaveBeenCalledWith( site.id, 43, expect.anything() )
		);
		await screen.findByText( 'Changes pulled into WordPress Studio' );
		await actions.click( screen.getByRole( 'button', { name: 'Done' } ) );
		await actions.click( await screen.findByRole( 'button', { name: 'Website actions' } ) );
		await actions.click( await screen.findByRole( 'menuitem', { name: 'Disconnect…' } ) );
		const confirmation = await screen.findByRole( 'alertdialog' );
		await actions.click( within( confirmation ).getByRole( 'button', { name: 'Disconnect' } ) );
		await screen.findByRole( 'combobox', { name: 'Switch website: example.com' } );
		expect( await connector.getConnectedWpcomSites( site.id ) ).toEqual( [ remote ] );
		expect( connector.disconnectWpcomSite ).toHaveBeenCalledWith( site.id, 43 );
	} );

	it( 'does not show another destination’s completed pull on the selected site', async () => {
		const actions = userEvent.setup();
		const second = { ...remote, id: 43, name: 'Second site', url: 'https://second.example.com' };
		const { ready, emit } = setup( [ remote, second ], true, true, false );
		await ready;
		emit( { kind: 'pending', direction: 'pull', remoteSiteId: 42 } );
		emit( { kind: 'success', direction: 'pull' } );
		await actions.click(
			await screen.findByRole( 'combobox', { name: 'Switch website: example.com' } )
		);
		await actions.click(
			await screen.findByRole( 'option', { name: /^second.example.com Production$/ } )
		);
		await openPull();
		expect( screen.queryByText( 'Changes pulled into WordPress Studio' ) ).not.toBeInTheDocument();
		expect( screen.queryByRole( 'button', { name: 'Done' } ) ).not.toBeInTheDocument();
		expect( screen.getByRole( 'button', { name: 'Pull changes' } ) ).toBeVisible();
	} );

	it( 'returns to the current destination when connecting another site is cancelled', async () => {
		const actions = userEvent.setup();
		const { connector, ready } = setup( [ remote ], true, true, false );
		await ready;
		await actions.click(
			await screen.findByRole( 'combobox', { name: 'Switch website: example.com' } )
		);
		await actions.click( await screen.findByRole( 'option', { name: 'Connect another site…' } ) );
		await actions.click( await screen.findByRole( 'button', { name: 'Back to Publish' } ) );
		expect(
			await screen.findByRole( 'combobox', { name: 'Switch website: example.com' } )
		).toBeVisible();
		expect( connector.connectWpcomSite ).not.toHaveBeenCalled();
	} );

	it( 'connects another destination without replacing the first and can switch back', async () => {
		const actions = userEvent.setup();
		const second = { ...remote, id: 43, name: 'Second site', url: 'https://second.example.com' };
		const { connector, ready, site } = setup( [ remote ], true, true, false );
		connector.fetchSyncableWpcomSites.mockResolvedValue( [ remote, second ] );
		await ready;
		await actions.click(
			await screen.findByRole( 'combobox', { name: 'Switch website: example.com' } )
		);
		await actions.click( await screen.findByRole( 'option', { name: 'Connect another site…' } ) );
		await actions.click(
			await screen.findByRole( 'option', { name: /Second site.*second.example.com/ } )
		);
		await screen.findByRole( 'combobox', { name: 'Switch website: second.example.com' } );
		expect( connector.connectWpcomSite ).toHaveBeenCalledWith(
			site.id,
			expect.objectContaining( { id: 43 } )
		);
		expect( await connector.getConnectedWpcomSites( site.id ) ).toHaveLength( 2 );
		expect( connector.pushSiteToLive ).not.toHaveBeenCalled();
		expect( connector.pullSiteFromLive ).not.toHaveBeenCalled();
		await actions.click(
			screen.getByRole( 'combobox', { name: 'Switch website: second.example.com' } )
		);
		await actions.click(
			await screen.findByRole( 'option', { name: /^example.com Production$/ } )
		);
		expect( screen.getByRole( 'combobox', { name: 'Switch website: example.com' } ) ).toBeVisible();
	} );
} );

it( 'opens the requested publishing screen for the requested destination without starting a transfer', async () => {
	const actions = userEvent.setup();
	const other = { ...remote, id: 43, url: 'https://other.example.com' };
	const { connector, ready, site } = setup( [ remote, other ] );
	await ready;
	await screen.findByRole( 'radiogroup', { name: 'What to publish' } );
	act( () =>
		requestHeaderPanel( { panel: 'publish', siteId: site.id, view: 'pull', remoteSiteId: 43 } )
	);
	const pull = await screen.findByRole( 'button', { name: 'Pull changes' } );
	await waitFor( () => expect( pull ).toBeEnabled() );
	expect( screen.getByText( 'other.example.com' ) ).toBeVisible();
	expect( connector.pullSiteFromLive ).not.toHaveBeenCalled();
	expect( connector.pushSiteToLive ).not.toHaveBeenCalled();
	await actions.click( pull );
	await waitFor( () =>
		expect( connector.pullSiteFromLive ).toHaveBeenCalledWith( site.id, 43, {
			optionsToSync: [ 'all' ],
		} )
	);
	await screen.findByText( 'Changes pulled into WordPress Studio', {}, { timeout: 3000 } );
	act( () =>
		requestHeaderPanel( { panel: 'publish', siteId: site.id, view: 'websites', remoteSiteId: 43 } )
	);
	await screen.findByRole( 'dialog', { name: 'Share and publish' } );
	act( () =>
		requestHeaderPanel( { panel: 'publish', siteId: site.id, view: 'publish', remoteSiteId: 42 } )
	);
	await screen.findByRole( 'button', { name: 'Publish changes' } );
	expect( screen.getByRole( 'group', { name: 'Website' } ) ).toHaveTextContent( 'example.com' );
} );

it( 'reloads failed connections without showing the raw error or publishing', async () => {
	const actions = userEvent.setup();
	const { connector, ready, queryClient } = setup();
	await ready;
	await screen.findByRole( 'button', { name: 'New site…' } );
	connector.getConnectedWpcomSites.mockRejectedValue( new Error( 'Load failed' ) );
	await act( async () => {
		await queryClient.invalidateQueries();
	} );
	const reload = await screen.findByRole( 'button', { name: 'Reload' } );
	expect( screen.queryByText( 'Load failed' ) ).not.toBeInTheDocument();
	connector.getConnectedWpcomSites.mockResolvedValue( [] );
	await actions.click( reload );
	await screen.findByRole( 'button', { name: 'New site…' } );
	expect( connector.pushSiteToLive ).not.toHaveBeenCalled();
	expect( connector.openExternalUrl ).not.toHaveBeenCalled();
} );
