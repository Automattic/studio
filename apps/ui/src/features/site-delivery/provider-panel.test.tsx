import { TRACKS_EVENTS } from '@studio/common/lib/record-tracks-event';
import { getProvider } from '@studio/providers';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, it } from 'vitest';
import { getVisibleToasts } from '@/data/app-messages';
import { buildPublishCheckoutUrl } from '@/data/core/connectors/publish-checkout-url';
import { remoteSitesQueryKey } from '@/data/queries/use-remote-sites';
import { SNAPSHOT_USAGE_QUERY_KEY } from '@/data/queries/user-scoped-query-keys';
import { requestHeaderPanel } from '@/data/use-open-header-panel';
import { createFakeConnector, makeSite, TEST_USER, aiSettings } from '@/test/fake-connector';
import { renderWithProviders } from '@/test/render';
import pressableLogo from './pressable-logo.svg?raw';
import { PublishButton } from './publish-button';
import type { Snapshot } from '@/data/core';
import type { ConnectorOverrides } from '@/test/in-memory-connector';
const site = makeSite( { id: 'provider-panel' } );
const live = {
	id: 42,
	localSiteId: site.id,
	name: 'Live',
	url: 'https://lente.blog',
	isStaging: false,
	isPressable: false,
	syncSupport: 'syncable' as const,
	launchStatus: 'launched',
	lastPushTimestamp: new Date().toISOString(),
	lastPullTimestamp: null,
};
const space = {
	id: 'spc_1',
	name: 'Static',
	url: 'https://lente.space.fast',
	slug: 'lente',
	teamId: 'team',
	teamSlug: 'studio',
	localSiteId: site.id,
	lastPushTimestamp: new Date().toISOString(),
	lastPullTimestamp: null,
};
const preview: Snapshot = {
	atomicSiteId: 123,
	localSiteId: site.id,
	userId: TEST_USER.id,
	date: Date.now(),
	url: 'lente-preview.wpcomstaging.com',
	shareUrl: 'https://lente-preview.wpcomstaging.com/?share=secret',
};
let sequence = 0;
beforeEach( () => {
	localStorage.clear();
	site.id = `provider-panel-${ ++sequence }`;
	live.localSiteId = site.id;
	space.localSiteId = site.id;
	preview.localSiteId = site.id;
} );
function setup( overrides: ConnectorOverrides = {} ) {
	const connector = createFakeConnector(
		{ sites: [ site ], user: TEST_USER },
		{
			getAiSettings: async () => aiSettings( 'wpcom', [ 'wpcom', 'spacefast' ] ),
			getPublishCheckoutUrl: buildPublishCheckoutUrl,
			getSnapshots: async () => [ preview ],
			getSnapshotUsage: async () => ( { siteCount: 1, siteLimit: 5, siteCreationBlocked: false } ),
			getRemoteSites: async ( provider ) => ( provider === 'wpcom' ? [ live ] : [ space ] ),
			listAccountSites: async ( provider ) => ( provider === 'wpcom' ? [ live ] : [ space ] ),
			getSiteVisibility: async ( provider, id ) => ( {
				url:
					provider === 'spacefast'
						? id === 'spc_2'
							? 'https://second.space.fast'
							: space.url
						: live.url,
				launchStatus: 'launched',
				visibility: 'public',
			} ),
			getSitePublishStatus: async ( _local, _remote, provider ) => ( {
				localChanged: provider === 'spacefast',
			} ),
			getPreviewStatus: async () => ( {
				localSiteId: site.id,
				localChanged: false,
				previewChanged: false,
			} ),
			listLocalFileTree: async () =>
				[ 'plugins', 'themes', 'uploads' ].map( ( name ) => ( {
					name,
					path: `wp-content/${ name }`,
					isDirectory: true,
					children: [],
				} ) ),
			...overrides,
		}
	);
	return { ...renderWithProviders( <PublishButton site={ site } />, { connector } ), connector };
}
async function open() {
	fireEvent.click( await screen.findByRole( 'button', { name: /^Share…$/ } ) );
	return screen.findByRole( 'dialog', { name: /^(Share this WordPress|Share)$/ } );
}
async function openSiteActions( user: ReturnType< typeof setup >[ 'user' ] ) {
	await user.click( await screen.findByRole( 'button', { name: 'Site actions' } ) );
	return screen.findByRole( 'menu', { name: 'Site actions' } );
}
async function confirmPublish() {
	const dialog = await screen.findByRole( 'alertdialog', { name: 'Publish changes?' } );
	const publish = within( dialog ).getByRole( 'button', { name: 'Publish changes' } );
	await waitFor( () => expect( publish ).toBeEnabled() );
	fireEvent.click( publish );
	await waitFor( () => expect( dialog ).not.toBeInTheDocument() );
}
async function openDestinations() {
	fireEvent.click( await screen.findByRole( 'button', { name: /^(Site|Preview) actions$/ } ) );
	fireEvent.click( await screen.findByRole( 'menuitem', { name: 'Switch to' } ) );
	return screen.findByRole( 'menu', { name: 'Destinations' } );
}
async function switchTo( hostname: string ) {
	if ( hostname === preview.url ) return;
	const menu = await openDestinations();
	fireEvent.click( within( menu ).getByRole( 'menuitemradio', { name: hostname } ) );
}
async function openPreviews( user: ReturnType< typeof setup >[ 'user' ] ) {
	const row = screen.queryByRole( 'button', { name: 'Switch previews' } );
	if ( row ) await user.click( row );
	else act( () => requestHeaderPanel( { panel: 'share', siteId: site.id } ) );
	return screen.findByRole( 'dialog', { name: 'Previews' } );
}

async function selectPreview( user: ReturnType< typeof setup >[ 'user' ], name: string ) {
	const list =
		screen.queryByRole( 'dialog', { name: 'Previews' } ) ?? ( await openPreviews( user ) );
	await user.click( within( list ).getByText( name, { exact: true } ) );
	return screen.findByRole( 'group', { name: `Preview: ${ name }` } );
}
async function openPreviewActions( user: ReturnType< typeof setup >[ 'user' ], name: string ) {
	const row =
		screen.queryByRole( 'group', { name: `Preview: ${ name }` } ) ??
		( await selectPreview( user, name ) );
	await user.click( within( row ).getByRole( 'button', { name: 'Preview actions' } ) );
	return screen.findByRole( 'menu', { name } );
}
it( 'shares one in-flight preview comparison between the toolbar and Share panel', async () => {
	const { connector } = setup( {
		getRemoteSites: async () => [],
		getPreviewStatus: () => new Promise( () => {} ),
	} );
	await open();
	await waitFor( () => expect( connector.getPreviewStatus ).toHaveBeenCalled() );
	expect( connector.getPreviewStatus ).toHaveBeenCalledTimes( 1 );
} );

it( 'keeps a failed disconnect open for retry and preserves the preview after success', async () => {
	let connected = true;
	const { connector, user } = setup( {
		getRemoteSites: async ( provider ) => ( connected && provider === 'wpcom' ? [ live ] : [] ),
		disconnectRemoteSite: async () => {
			connected = false;
		},
	} );
	connector.disconnectRemoteSite.mockRejectedValueOnce( new Error( 'Could not disconnect' ) );
	await open();
	await openSiteActions( user );
	await user.click( screen.getByRole( 'menuitem', { name: 'Disconnect site…' } ) );
	const dialog = await screen.findByRole( 'alertdialog', { name: 'Disconnect site?' } );
	expect( connector.disconnectRemoteSite ).not.toHaveBeenCalled();
	const confirm = within( dialog ).getByRole( 'button', { name: 'Disconnect site' } );
	await user.click( confirm );
	expect( await within( dialog ).findByRole( 'alert' ) ).toHaveTextContent(
		'Could not disconnect'
	);
	expect( connected ).toBe( true );
	await user.click( confirm );
	await waitFor( () => expect( dialog ).not.toBeInTheDocument() );
	expect( connector.disconnectRemoteSite ).toHaveBeenLastCalledWith( 'wpcom', site.id, live.id );
	expect( connector.deleteSnapshot ).not.toHaveBeenCalled();
	expect( await screen.findByRole( 'button', { name: 'Previews' } ) ).toBeVisible();
} );

it( 'renders the selected provider capabilities and isolates its change dot', async () => {
	const { user, connector } = setup();
	await open();
	expect( await screen.findByRole( 'combobox', { name: 'Who can view' } ) ).toBeVisible();
	expect( screen.queryByRole( 'button', { name: 'What to publish' } ) ).not.toBeInTheDocument();
	expect( screen.queryByText( 'Some features may not work' ) ).not.toBeInTheDocument();
	expect( screen.queryByLabelText( 'Local changes' ) ).not.toBeInTheDocument();
	const menu = await openSiteActions( user );
	expect(
		within( menu )
			.getAllByRole( 'menuitem' )
			.map( ( item ) => item.textContent?.trim() )
	).toEqual( [
		'Switch to',
		'Update from live site…',
		'View backups',
		'Change destination…',
		'Disconnect site…',
	] );
	await user.click( within( menu ).getByRole( 'menuitem', { name: 'Update from live site…' } ) );
	const confirmation = await screen.findByRole( 'alertdialog', {
		name: 'Update local site from lente.blog?',
	} );
	expect( confirmation ).toHaveTextContent(
		'This replaces the selected parts of your local site with what’s on lente.blog. Any local changes in those parts will be lost.'
	);
	expect( connector.pullSite ).not.toHaveBeenCalled();
	expect(
		within( confirmation ).getByRole( 'combobox', { name: 'What to replace' } )
	).toBeVisible();
	await user.click( within( confirmation ).getByRole( 'button', { name: 'Cancel' } ) );
	await waitFor( () => expect( confirmation ).not.toBeInTheDocument() );
	await openDestinations();
	await user.click( await screen.findByRole( 'menuitemradio', { name: 'lente.space.fast' } ) );
	expect( await screen.findByRole( 'link', { name: 'Open lente.space.fast' } ) ).toBeVisible();
	expect( screen.queryByRole( 'link', { name: 'Open lente.blog' } ) ).not.toBeInTheDocument();
	expect( screen.queryByText( 'Some features may not work' ) ).not.toBeInTheDocument();
	expect( screen.queryByText( 'Like forms, comments, and search' ) ).not.toBeInTheDocument();
	expect( screen.getByRole( 'combobox', { name: 'Who can view' } ) ).toBeVisible();
	expect( screen.queryByRole( 'button', { name: 'What to publish' } ) ).not.toBeInTheDocument();
	expect( screen.getByRole( 'button', { name: 'Update…' } ) ).toBeVisible();
	expect( screen.getByLabelText( 'Local changes' ) ).toBeVisible();
	expect(
		within( screen.getByRole( 'group', { name: 'Published site actions' } ) ).queryByRole(
			'button',
			{ name: 'Copy link' }
		)
	).not.toBeInTheDocument();
	const spacefastMenu = await openSiteActions( user );
	expect(
		within( spacefastMenu )
			.getAllByRole( 'menuitem' )
			.map( ( item ) => item.textContent?.trim() )
	).toEqual( [
		'Switch to',
		'Open on Spacefast',
		'Versions',
		'Change destination…',
		'Disconnect site…',
	] );
	await user.click(
		within( spacefastMenu ).getByRole( 'menuitem', { name: 'Open on Spacefast' } )
	);
	expect( connector.openExternalUrl ).toHaveBeenCalledExactlyOnceWith(
		'https://my.spacefast.com/'
	);
	await user.click(
		within( screen.getByRole( 'region', { name: 'Suggested' } ) ).getByRole( 'button', {
			name: 'Add a domain',
		} )
	);
	expect( connector.openExternalUrl ).toHaveBeenLastCalledWith(
		'https://my.spacefast.com/studio/lente/domains/add'
	);
} );

it( 'keeps a connected site and its preview reachable from one domain row', async () => {
	const { connector, user } = setup( {
		getRemoteSites: async ( provider ) => ( provider === 'wpcom' ? [ live ] : [] ),
	} );
	const panel = await open();
	expect( within( panel ).getAllByText( 'lente.blog', { exact: true } ) ).toHaveLength( 1 );
	const menu = await openSiteActions( user );
	expect( within( menu ).getByRole( 'menuitem', { name: 'Change destination…' } ) ).toBeEnabled();
	await user.click( within( menu ).getByRole( 'menuitem', { name: 'Switch to' } ) );
	const destinations = await screen.findByRole( 'menu', { name: 'Destinations' } );
	fireEvent.click( within( destinations ).getByRole( 'menuitemradio', { name: 'Preview 1' } ) );
	expect(
		await within( panel ).findByRole( 'link', { name: `Open preview: ${ preview.url }` } )
	).toBeVisible();
	await switchTo( 'lente.blog' );
	expect( await within( panel ).findByRole( 'link', { name: 'Open lente.blog' } ) ).toBeVisible();
	await waitFor( () =>
		expect( within( panel ).getByRole( 'button', { name: 'Site actions' } ) ).toHaveFocus()
	);
	expect( within( panel ).getAllByText( 'lente.blog', { exact: true } ) ).toHaveLength( 1 );
	expect( connector.disconnectRemoteSite ).not.toHaveBeenCalled();
	expect( connector.pushSite ).not.toHaveBeenCalled();
	expect( connector.publishPreviewSite ).not.toHaveBeenCalled();
} );

it( 'shows a site actions menu for a single connected site', async () => {
	const { connector, user } = setup( {
		getAuthUser: async () => null,
		getAiSettings: async () => aiSettings( 'wpcom', [ 'spacefast' ] ),
		getRemoteSites: async ( provider ) => ( provider === 'spacefast' ? [ space ] : [] ),
	} );
	const panel = await open();
	expect(
		within( panel ).queryByRole( 'button', { name: 'Switch previews' } )
	).not.toBeInTheDocument();
	expect(
		within( panel ).queryByRole( 'button', { name: 'Choose destination' } )
	).not.toBeInTheDocument();
	expect( within( panel ).getByRole( 'link', { name: 'Open lente.space.fast' } ) ).toBeVisible();
	const menu = await openSiteActions( user );
	expect(
		within( menu )
			.getAllByRole( 'menuitem' )
			.map( ( item ) => item.textContent?.trim() )
	).toEqual( [ 'Open on Spacefast', 'Versions', 'Change destination…', 'Disconnect site…' ] );
	await user.click( within( menu ).getByRole( 'menuitem', { name: 'Versions' } ) );
	expect( connector.openExternalUrl ).toHaveBeenCalledExactlyOnceWith(
		'https://my.spacefast.com/studio/lente/versions'
	);
} );

it( 'opens Sharing settings from an explicit Share request on a Spacefast site', async () => {
	const { history, connector } = setup( {
		getRemoteSites: async ( provider ) => ( provider === 'spacefast' ? [ space ] : [] ),
	} );
	act( () => requestHeaderPanel( { panel: 'share', siteId: site.id } ) );
	await waitFor( () => expect( history.location.search ).toBe( '?settings=sharing' ) );
	expect( screen.queryByRole( 'dialog', { name: 'Previews' } ) ).not.toBeInTheDocument();
	expect( connector.publishPreviewSite ).not.toHaveBeenCalled();
} );

it( 'opens Versions for a saved Spacefast connection without a team slug', async () => {
	const { connector, user } = setup( {
		getAiSettings: async () => aiSettings( 'wpcom', [ 'wpcom' ] ),
		getRemoteSites: async ( provider ) =>
			provider === 'spacefast' ? [ { ...space, teamSlug: undefined } ] : [],
	} );
	await open();
	const menu = await openSiteActions( user );
	await user.click( within( menu ).getByRole( 'menuitem', { name: 'Versions' } ) );
	expect( connector.openExternalUrl ).toHaveBeenCalledExactlyOnceWith(
		'https://my.spacefast.com/team/spc_1/versions'
	);
} );

it( 'opens the preview menu for Share requests and closes it for Publish requests', async () => {
	setup();
	await screen.findByRole( 'button', { name: 'Share…' } );
	act( () => requestHeaderPanel( { panel: 'share', siteId: site.id } ) );
	expect( await screen.findByRole( 'dialog', { name: 'Previews' } ) ).toBeVisible();
	act( () => requestHeaderPanel( { panel: 'publish', siteId: site.id, view: 'publish' } ) );
	expect( await screen.findByRole( 'heading', { name: 'Details' } ) ).toBeVisible();
	expect( screen.queryByRole( 'dialog', { name: 'Previews' } ) ).not.toBeInTheDocument();
} );

it( 'can create a new preview from the Previews menu', async () => {
	const { user, connector } = setup( {
		publishPreviewSite: () => new Promise( () => {} ),
	} );
	await open();
	await openPreviews( user );
	await user.click( await screen.findByRole( 'button', { name: 'New preview' } ) );
	await waitFor( () =>
		expect( connector.publishPreviewSite ).toHaveBeenCalledExactlyOnceWith(
			site.id,
			undefined,
			undefined
		)
	);
} );

it( 'offers preview creation in Suggested for a single preview', async () => {
	setup( { getRemoteSites: async () => [] } );
	const panel = await open();
	expect( within( panel ).queryByRole( 'heading', { name: 'Preview' } ) ).not.toBeInTheDocument();
	expect( within( panel ).getByRole( 'button', { name: 'Copy link' } ) ).toBeVisible();
	expect( within( panel ).getByRole( 'button', { name: 'Update' } ) ).toBeVisible();
	expect( within( panel ).queryByRole( 'group', { name: 'Actions' } ) ).not.toBeInTheDocument();
	expect(
		within( within( panel ).getByRole( 'region', { name: 'Suggested' } ) ).getByRole( 'button', {
			name: 'Create new preview',
		} )
	).toBeVisible();
} );

it.each( [
	{ hostname: 'lente.blog', url: live.url },
	{ hostname: 'lente.space.fast', url: space.url },
] )( 'shows the site actions menu next to Copy link for $hostname', async ( { hostname, url } ) => {
	const { user, connector } = setup();
	await open();
	await switchTo( hostname );
	const row = await screen.findByRole( 'link', { name: `Open ${ hostname }` } );
	const actions = screen.getByRole( 'group', { name: 'Published site actions' } );
	expect( within( actions ).getByRole( 'button', { name: 'Update…' } ) ).toBeVisible();
	expect( screen.queryByRole( 'heading', { name: 'Actions' } ) ).not.toBeInTheDocument();
	fireEvent.contextMenu( row );
	expect( screen.queryByRole( 'menu', { name: 'Site actions' } ) ).not.toBeInTheDocument();
	const copy = screen.getByRole( 'button', { name: 'Copy link' } );
	const trigger = screen.getByRole( 'button', { name: 'Site actions' } );
	expect( copy.nextElementSibling ).toBe( trigger );
	trigger.focus();
	await user.keyboard( '{Enter}' );
	const menu = await screen.findByRole( 'menu', { name: 'Site actions' } );
	expect( within( menu ).queryByRole( 'menuitem', { name: 'Copy link' } ) ).not.toBeInTheDocument();
	await user.keyboard( '{Escape}' );
	await waitFor( () => expect( trigger ).toHaveFocus() );
	await user.click( copy );
	expect( connector.copyText ).toHaveBeenCalledExactlyOnceWith( url );
	expect( connector.openExternalUrl ).not.toHaveBeenCalled();
} );

it( 'reports a Spacefast creation failure as a notice and briefly marks Publish red', async () => {
	const description =
		"Failed to create the Space: This team already has 5 Spaces that haven't been published.";
	let created = false;
	const { connector, user } = setup( {
		getRemoteSites: async ( provider ) => ( created && provider === 'spacefast' ? [ space ] : [] ),
		getSnapshots: async () => [],
		createRemoteSite: async () => {
			created = true;
			return space;
		},
	} );
	connector.state.preferences.defaultHostingProvider = 'spacefast';
	connector.createRemoteSite.mockRejectedValueOnce( new Error( description ) );

	const panel = await open();
	expect( panel ).toHaveAccessibleName( 'Share this WordPress' );
	const publish = within( panel ).getByRole( 'button', { name: 'Publish' } );
	await user.click( publish );
	const notices = () =>
		getVisibleToasts().filter(
			( notice ) => ! notice.leaving && notice.description === description
		);
	await waitFor( () =>
		expect( notices() ).toMatchObject( [ { title: 'Publishing didn’t finish', durationMs: 0 } ] )
	);
	expect( within( panel ).queryByText( description ) ).not.toBeInTheDocument();
	expect( within( panel ).getByRole( 'button', { name: 'Publish' } ) ).toHaveAttribute(
		'data-variant',
		'destructive'
	);
	await waitFor(
		() =>
			expect( within( panel ).getByRole( 'button', { name: 'Publish' } ) ).toHaveAttribute(
				'data-variant',
				'accent'
			),
		{ timeout: 2000 }
	);
	await user.keyboard( '{Escape}' );
	await waitFor( () => expect( panel ).not.toBeInTheDocument() );
	expect( notices() ).toHaveLength( 1 );
	const reopened = await open();
	await user.click( within( reopened ).getByRole( 'button', { name: 'Publish' } ) );
	expect( await within( reopened ).findByRole( 'button', { name: 'Update…' } ) ).toBeVisible();
	expect( reopened ).toHaveAccessibleName( 'Share' );
	expect( notices() ).toHaveLength( 0 );
} );

it( 'reports a failed live push as a notification while keeping the panel open', async () => {
	setup( {
		pushSite: async () => {
			throw new Error( 'Upload failed' );
		},
	} );
	await open();
	await switchTo( 'lente.space.fast' );
	const publish = await screen.findByRole( 'button', { name: 'Update…' } );
	await waitFor( () => expect( publish ).toBeEnabled() );
	fireEvent.click( publish );
	await confirmPublish();
	await waitFor(
		() =>
			expect( getVisibleToasts().filter( ( notice ) => notice.intent === 'error' ) ).toMatchObject(
				[ { title: 'Publishing didn’t finish' } ]
			),
		{ timeout: 3000 }
	);
	const panel = screen.getByRole( 'dialog', { name: 'Share' } );
	expect( panel ).toBeVisible();
	expect( within( panel ).queryByRole( 'alert' ) ).not.toBeInTheDocument();
	expect( within( panel ).getByRole( 'button', { name: 'Update…' } ) ).toBeEnabled();
} );
it( 'uses preview names consistently in the Share panel and selector', async () => {
	const unnamed = { ...preview, sequence: 7, date: Date.now() - 1000 };
	const named = {
		...preview,
		atomicSiteId: 456,
		date: Date.now(),
		name: 'Homepage refresh',
		url: 'homepage-preview.wpcomstaging.com',
	};
	const { user, connector } = setup( {
		getRemoteSites: async () => [],
		getSnapshots: async () => [ unnamed, named ],
	} );
	await open();
	const selector = screen.getByRole( 'button', { name: 'Switch previews' } );
	const whoCanView = screen.getByRole( 'combobox', { name: 'Who can view' } );
	expect( whoCanView.parentElement?.nextElementSibling ).toBe( selector );
	expect( selector ).toHaveTextContent( named.name );
	const row = await selectPreview( user, 'Preview 7' );
	expect( screen.queryByRole( 'dialog', { name: 'Previews' } ) ).not.toBeInTheDocument();
	expect( screen.queryByRole( 'menu' ) ).not.toBeInTheDocument();
	expect( row ).toHaveTextContent( unnamed.url );
	expect( screen.getByText( 'Expires on' ) ).toBeVisible();
	await user.click( await screen.findByRole( 'link', { name: /^Open preview:/ } ) );
	expect( connector.openExternalUrl ).toHaveBeenCalledWith( unnamed.shareUrl );
	await user.click( within( row ).getByRole( 'button', { name: 'Copy link' } ) );
	expect( connector.copyText ).toHaveBeenCalledWith( unnamed.shareUrl );
} );

it( 'selects a preview by keyboard and returns to Share', async () => {
	const second = {
		...preview,
		atomicSiteId: 456,
		name: 'Client review',
		url: 'second-preview.wpcomstaging.com',
		shareUrl: 'https://second-preview.wpcomstaging.com/?share=second',
	};
	const { user, connector } = setup( { getSnapshots: async () => [ preview, second ] } );
	const panel = await open();
	expect( within( panel ).getByRole( 'link', { name: 'Open lente.blog' } ) ).toBeVisible();
	const trigger = within( panel ).getByRole( 'button', { name: 'Switch previews' } );
	expect( trigger ).toHaveAccessibleDescription( '2' );
	trigger.focus();
	await user.keyboard( '{Enter}' );
	const menu = await screen.findByRole( 'dialog', { name: 'Previews' } );
	expect( menu ).toBe( panel );
	expect( within( panel ).queryByText( 'Who can view', { exact: true } ) ).not.toBeInTheDocument();
	const previewRow = within( menu ).getByRole( 'button', { name: /^Client review/ } );
	expect( previewRow ).toHaveTextContent( second.url );
	expect( within( menu ).queryByText( /Expires/ ) ).not.toBeInTheDocument();
	previewRow.focus();
	await user.keyboard( '{Enter}' );
	const selectedRow = await within( panel ).findByRole( 'group', {
		name: 'Preview: Client review',
	} );
	expect( selectedRow ).toHaveTextContent( second.url );
	expect( screen.queryByRole( 'menu' ) ).not.toBeInTheDocument();
	const returned = await within( panel ).findByRole( 'button', { name: 'Switch previews' } );
	await waitFor( () => expect( returned ).toHaveFocus() );
	await user.click( returned );
	const reopened = await screen.findByRole( 'dialog', { name: 'Previews' } );
	expect(
		within( reopened ).getByRole( 'button', { name: /^Client review/, current: true } )
	).toBeVisible();
	await user.click( within( reopened ).getByRole( 'button', { name: 'Back' } ) );
	const reopenedRow = await within( panel ).findByRole( 'group', {
		name: 'Preview: Client review',
	} );
	await user.click( within( reopenedRow ).getByRole( 'button', { name: 'Copy link' } ) );
	expect( connector.copyText ).toHaveBeenCalledExactlyOnceWith( second.shareUrl );
	expect( connector.openExternalUrl ).not.toHaveBeenCalled();
	await switchTo( 'lente.blog' );
	expect( await within( panel ).findByRole( 'link', { name: 'Open lente.blog' } ) ).toBeVisible();
} );

it( 'uses the selected preview for rename and delete', async () => {
	const second = {
		...preview,
		atomicSiteId: 456,
		name: 'Homepage refresh',
		url: 'homepage-preview.wpcomstaging.com',
	};
	let snapshots = [ preview, second ];
	const { user, connector } = setup( {
		getSnapshots: async () => snapshots,
		renameSnapshot: async ( hostname, name ) => {
			snapshots = snapshots.map( ( item ) => ( item.url === hostname ? { ...item, name } : item ) );
		},
	} );
	await open();
	const actions = await openPreviewActions( user, second.name );
	await user.click( within( actions ).getByRole( 'menuitem', { name: 'Rename' } ) );
	const input = await screen.findByRole( 'textbox', { name: 'Preview name' } );
	expect( input ).toHaveValue( second.name );
	await user.clear( input );
	await user.type( input, 'Client review{Enter}' );
	await waitFor( () =>
		expect( screen.queryByRole( 'dialog', { name: 'Rename preview' } ) ).not.toBeInTheDocument()
	);
	expect( connector.renameSnapshot ).toHaveBeenCalledExactlyOnceWith( second.url, 'Client review' );
	if ( ! screen.queryByRole( 'dialog', { name: 'Share' } ) ) await open();
	const renamedActions = await openPreviewActions( user, 'Client review' );
	await user.click( within( renamedActions ).getByRole( 'menuitem', { name: 'Delete preview' } ) );
	const confirmation = await screen.findByRole( 'alertdialog', { name: 'Delete preview?' } );
	expect( within( confirmation ).getByText( 'Client review' ) ).toBeVisible();
	await user.click( within( confirmation ).getByRole( 'button', { name: 'Cancel' } ) );
	expect( connector.deleteSnapshot ).not.toHaveBeenCalled();
} );

it( 'keeps the previews step open while adding a preview', async () => {
	let finish!: ( result: { url: string } ) => void;
	let snapshots = [ preview ];
	const created = {
		...preview,
		atomicSiteId: 457,
		name: 'New preview for review',
		url: 'new-preview.wpcomstaging.com',
	};
	const { user } = setup( {
		getRemoteSites: async ( provider ) => ( provider === 'wpcom' ? [ live ] : [] ),
		getSnapshots: async () => snapshots,
		publishPreviewSite: () =>
			new Promise( ( resolve ) => {
				finish = resolve;
			} ),
	} );
	const panel = await open();
	const menu = await openPreviews( user );
	await user.click( within( menu ).getByRole( 'button', { name: 'New preview' } ) );
	expect( await within( menu ).findByRole( 'button', { name: /Creating preview/ } ) ).toBeVisible();
	expect( panel ).toBeVisible();
	expect( panel ).toBe( menu );
	expect(
		within( panel ).queryByText( 'What to publish', { exact: true } )
	).not.toBeInTheDocument();
	snapshots = [ created, preview ];
	act( () => finish( { url: created.url } ) );
	expect(
		await within( menu ).findByRole( 'button', { name: new RegExp( `^${ created.name }` ) } )
	).toBeVisible();
} );

it( 'checks and updates the selected preview', async () => {
	const second = {
		...preview,
		atomicSiteId: 456,
		name: 'Client review',
		url: 'second-preview.wpcomstaging.com',
	};
	const { user, connector } = setup( {
		getSnapshots: async () => [ second ],
		getRemoteSites: async () => [],
		getSitePublishStatus: async () => ( { localChanged: false } ),
		getPreviewStatus: async ( hostname ) => ( {
			localSiteId: site.id,
			localChanged: true,
			previewChanged: hostname === second.url,
		} ),
	} );
	await open();
	await user.click( await screen.findByRole( 'button', { name: 'Update' } ) );
	expect(
		await screen.findByRole( 'heading', { name: 'Replace preview changes?' } )
	).toBeVisible();
	expect(
		screen.getByText(
			`Changes on ${ second.url } will be replaced with your local files and database.`
		)
	).toBeVisible();
	expect( connector.publishPreviewSite ).not.toHaveBeenCalled();
	await user.click( screen.getByRole( 'button', { name: 'Replace preview' } ) );
	await waitFor( () =>
		expect( connector.publishPreviewSite ).toHaveBeenCalledExactlyOnceWith(
			site.id,
			second.url,
			undefined
		)
	);
	expect( connector.pushSite ).not.toHaveBeenCalled();
} );

it.each( [
	{ host: 'Pressable', isPressable: true, logo: pressableLogo },
	{ host: 'WordPress.com', isPressable: false, logo: getProvider( 'wpcom' ).logo! },
] )( 'uses the $host logo for a connected $host site', async ( { isPressable, logo } ) => {
	const remote = { ...live, isPressable };
	setup( {
		getSnapshots: async () => [],
		getRemoteSites: async ( provider ) => ( provider === 'wpcom' ? [ remote ] : [ space ] ),
		listAccountSites: async ( provider ) => ( provider === 'wpcom' ? [ remote ] : [ space ] ),
	} );
	const hostname = new URL( remote.url ).hostname;
	const panel = await open();
	const openSite = await within( panel ).findByRole( 'link', { name: `Open ${ hostname }` } );
	expect( openSite.parentElement ).toContainHTML( logo );

	const picker = await openDestinations();
	expect( within( picker ).getByRole( 'menuitemradio', { name: hostname } ) ).toContainHTML( logo );
} );

it( 'keeps connected destinations separate from previews', async () => {
	const { connector, user } = setup( {
		getRemoteSites: async ( provider ) =>
			provider === 'wpcom' ? [ live ] : [ { ...space, lastPushTimestamp: null } ],
		listAccountSites: async ( provider ) => ( provider === 'wpcom' ? [ live ] : [] ),
	} );
	const panel = await open();
	const publish = screen.getByRole( 'button', { name: 'Share…' } );
	expect( within( publish ).queryByLabelText( 'Local changes' ) ).not.toBeInTheDocument();
	expect( within( panel ).getByRole( 'link', { name: 'Open lente.blog' } ) ).toBeVisible();
	expect(
		within( panel ).queryByRole( 'link', { name: 'Open lente.space.fast' } )
	).not.toBeInTheDocument();
	expect( within( panel ).queryByRole( 'group', { name: /^Preview:/ } ) ).not.toBeInTheDocument();
	expect(
		within( panel ).queryByRole( 'button', { name: 'Switch previews' } )
	).not.toBeInTheDocument();

	const menu = await openDestinations();
	const sites = menu;
	expect( within( sites ).getByRole( 'menuitemradio', { name: 'lente.blog' } ) ).toBeChecked();
	expect(
		within( menu ).queryByRole( 'menuitemradio', { name: 'lente-preview.wpcomstaging.com' } )
	).not.toBeInTheDocument();
	const staticSite = within( sites ).getByRole( 'menuitemradio', { name: 'lente.space.fast' } );
	expect( staticSite ).not.toHaveTextContent( 'Not published yet' );
	await user.click( staticSite );
	expect( await within( publish ).findByLabelText( 'Local changes' ) ).toBeVisible();
	expect( within( panel ).getByRole( 'button', { name: 'Update…' } ) ).toBeVisible();
	expect( within( panel ).getByRole( 'link', { name: 'Open lente.space.fast' } ) ).toBeVisible();
	expect(
		within( panel ).queryByRole( 'button', { name: 'Switch previews' } )
	).not.toBeInTheDocument();
	expect( connector.createRemoteSite ).not.toHaveBeenCalled();
	expect( connector.pushSite ).not.toHaveBeenCalled();
	expect( connector.publishPreviewSite ).not.toHaveBeenCalled();
} );

it( 'switches between two Spacefast sites by keyboard and restores focus', async () => {
	const second = {
		...space,
		id: 'spc_2',
		slug: 'second',
		url: 'https://second.space.fast',
		lastPushTimestamp: null,
	};
	const { connector, user } = setup( {
		getSnapshots: async () => [],
		getRemoteSites: async ( provider ) => ( provider === 'spacefast' ? [ space, second ] : [] ),
		getSitePublishStatus: async () => ( { localChanged: false } ),
	} );
	const panel = await open();
	expect( within( panel ).getByRole( 'link', { name: 'Open lente.space.fast' } ) ).toBeVisible();
	expect( await within( panel ).findByRole( 'button', { name: 'Update…' } ) ).toBeEnabled();
	const actions = within( panel ).getByRole( 'button', { name: 'Site actions' } );
	actions.focus();
	await user.keyboard( '{ArrowDown}' );
	const switcher = await screen.findByRole( 'menuitem', { name: 'Switch to' } );
	await waitFor( () => expect( switcher ).toHaveFocus() );
	await user.keyboard( '{ArrowRight}' );
	const menu = await screen.findByRole( 'menu', { name: 'Destinations' } );
	const firstOption = within( menu ).getByRole( 'menuitemradio', { name: 'lente.space.fast' } );
	expect( firstOption ).toBeChecked();
	await waitFor( () => expect( firstOption ).toHaveFocus() );
	expect(
		within( menu ).queryByRole( 'group', { name: 'Connected sites' } )
	).not.toBeInTheDocument();
	await user.keyboard( '{ArrowDown}' );
	await waitFor( () =>
		expect(
			within( menu ).getByRole( 'menuitemradio', { name: 'second.space.fast' } )
		).toHaveFocus()
	);
	await user.keyboard( '{Enter}' );
	await waitFor( () => expect( menu ).not.toBeInTheDocument() );
	expect( actions ).toHaveFocus();
	expect( within( panel ).getByRole( 'link', { name: 'Open second.space.fast' } ) ).toBeVisible();
	expect( within( panel ).queryByText( 'Not published yet' ) ).not.toBeInTheDocument();
	expect( within( panel ).getByRole( 'button', { name: 'Update…' } ) ).toBeEnabled();
	await user.click( await within( panel ).findByRole( 'button', { name: 'Copy link' } ) );
	expect( connector.copyText ).toHaveBeenCalledExactlyOnceWith( second.url );
	expect( connector.pushSite ).not.toHaveBeenCalled();
} );

it.each( [ 'last used', 'saved default' ] )(
	'keeps registry order with a Spacefast %s',
	async ( source ) => {
		localStorage.setItem(
			'studio-last-publish-provider',
			source === 'last used' ? 'spacefast' : 'wpcom'
		);
		const { connector, user } = setup( {
			getRemoteSites: async () => [],
			getSnapshots: async () => [],
		} );
		if ( source === 'saved default' ) {
			connector.state.preferences.defaultHostingProvider = 'spacefast';
		}
		await open();
		expect( screen.queryByText( 'Make it with Spacefast' ) ).not.toBeInTheDocument();
		await waitFor( () =>
			expect(
				screen.getByRole( 'combobox', { name: 'Who can view' } )
			).toHaveAccessibleDescription( 'Restricted' )
		);
		expect( screen.queryByText( 'A static copy of your pages.' ) ).not.toBeInTheDocument();
		expect( screen.getByRole( 'button', { name: 'Publish' } ) ).toBeVisible();
		expect( screen.getByText( 'Not published yet' ) ).toBeVisible();
		const destination = screen.getByRole( 'combobox', { name: 'Destination' } );
		destination.focus();
		await user.keyboard( '{ArrowDown}' );
		const picker = await screen.findByRole( 'listbox' );
		expect( within( picker ).getAllByRole( 'option' )[ 0 ] ).toHaveTextContent( 'WordPress.com' );
		expect( within( picker ).getByRole( 'option', { name: 'Spacefast' } ) ).toBeVisible();
	}
);

it( 'shows preview access when WordPress.com is the only available destination', async () => {
	const { connector } = setup( {
		capabilities: { nativeSites: false },
		getRemoteSites: async () => [],
		getSnapshots: async () => [],
		getPreviewStatus: async () => ( {
			localSiteId: site.id,
			localChanged: false,
			previewChanged: false,
		} ),
	} );
	await open();
	expect( screen.getByText( 'Destination' ) ).toBeVisible();
	expect( screen.queryByRole( 'combobox', { name: 'Destination' } ) ).not.toBeInTheDocument();
	expect( screen.getByRole( 'combobox', { name: 'Who can view' } ) ).toHaveAccessibleDescription(
		'Anyone with the link'
	);
	expect( screen.getByRole( 'button', { name: 'Create preview' } ) ).toBeVisible();
	expect( connector.publishPreviewSite ).not.toHaveBeenCalled();
} );

it.each( [
	{ policy: 'public', restrict: false, expected: 'public' },
	{ policy: 'public', restrict: true, expected: 'private' },
	{ policy: 'private', restrict: false, expected: 'private' },
] as const )(
	'publishes a new Space with $expected access (policy: $policy, restrict: $restrict)',
	async ( { policy, restrict, expected } ) => {
		let created = false;
		const { connector, user } = setup( {
			getSiteCreationVisibility: async () => policy,
			getSnapshots: async () => [],
			getRemoteSites: async ( provider ) =>
				provider === 'spacefast' && created ? [ space ] : [],
			createRemoteSite: async () => {
				created = true;
				return space;
			},
		} );
		await open();
		await user.click( screen.getByRole( 'combobox', { name: 'Destination' } ) );
		await user.click( await screen.findByRole( 'option', { name: 'Spacefast' } ) );
		expect( connector.createRemoteSite ).not.toHaveBeenCalled();
		expect( connector.pushSite ).not.toHaveBeenCalled();
		const access = await screen.findByRole( 'combobox', { name: 'Who can view' } );
		await waitFor( () => expect( access ).toHaveAccessibleDescription( 'Restricted' ) );
		await user.click( access );
		const everyone = await screen.findByRole( 'option', { name: 'Everyone' } );
		const restricted = screen.getByRole( 'option', { name: 'Restricted' } );
		if ( policy === 'private' ) {
			expect( everyone ).toHaveAttribute( 'aria-disabled', 'true' );
			expect( restricted ).toHaveAttribute( 'aria-selected', 'true' );
			expect( screen.getByText( 'Your team only allows restricted sites.' ) ).toBeVisible();
		}
		if ( policy === 'public' && ! restrict ) {
			await user.click( everyone );
			expect( access ).toHaveAccessibleDescription( 'Everyone' );
		} else {
			await user.keyboard( '{Escape}' );
		}
		expect( connector.createRemoteSite ).not.toHaveBeenCalled();
		await user.click( screen.getByRole( 'button', { name: 'Publish' } ) );
		await waitFor( () =>
			expect( connector.createRemoteSite ).toHaveBeenCalledExactlyOnceWith(
				'spacefast',
				site.id,
				site.name,
				expected,
				false
			)
		);
		await waitFor( () =>
			expect( connector.pushSite ).toHaveBeenCalledExactlyOnceWith(
				'spacefast',
				site.id,
				space.id,
				undefined
			)
		);
		expect(
			await screen.findByRole( 'link', { name: 'Open lente.space.fast' }, { timeout: 4000 } )
		).toBeVisible();
		expect( screen.queryByText( 'Some features may not work' ) ).not.toBeInTheDocument();
		expect(
			await screen.findByRole( 'button', { name: 'Share…' }, { timeout: 4000 } )
		).toBeVisible();
		expect( localStorage.getItem( 'studio-last-publish-provider' ) ).toBe( 'spacefast' );
	}
);

it( 'opens the selected preview from its URL without copying the link', async () => {
	const { user, connector } = setup();
	await open();
	const row = await selectPreview( user, 'Preview 1' );
	await user.click( within( row ).getByRole( 'link', { name: /^Open preview:/ } ) );
	expect( connector.openExternalUrl ).toHaveBeenCalledExactlyOnceWith( preview.shareUrl );
	expect( connector.copyText ).not.toHaveBeenCalled();
} );

it.each( [ 'selected', 'only', 'with preview' ] )(
	'removes the %s Spacefast connection only after confirmation',
	async ( state ) => {
		let removed = false;
		const { connector, user } = setup( {
			getRemoteSites: async ( provider ) =>
				provider === 'wpcom' ? ( state === 'selected' ? [ live ] : [] ) : removed ? [] : [ space ],
			getSnapshots: async () => ( state === 'with preview' ? [ preview ] : [] ),
			disconnectRemoteSite: async () => {
				removed = true;
			},
		} );
		await open();
		if ( state === 'selected' ) {
			await switchTo( 'lente.space.fast' );
			await screen.findByRole( 'link', { name: 'Open lente.space.fast' } );
		}
		const showConfirmation = async () => {
			const menu = await openSiteActions( user );
			await user.click( within( menu ).getByRole( 'menuitem', { name: 'Disconnect site…' } ) );
			return screen.findByRole( 'alertdialog', { name: 'Disconnect site?' } );
		};
		const cancelled = await showConfirmation();
		expect( cancelled ).toHaveTextContent(
			`Remove ${ space.url } from WordPress Studio? The published site and your local WordPress won’t change.`
		);
		await waitFor( () =>
			expect( within( cancelled ).getByRole( 'button', { name: 'Cancel' } ) ).toHaveFocus()
		);
		await user.click( within( cancelled ).getByRole( 'button', { name: 'Cancel' } ) );
		await waitFor( () => expect( cancelled ).not.toBeInTheDocument() );
		expect( connector.disconnectRemoteSite ).not.toHaveBeenCalled();

		await open();
		const confirmation = await showConfirmation();
		await user.click( within( confirmation ).getByRole( 'button', { name: 'Disconnect site' } ) );
		await waitFor( () => expect( confirmation ).not.toBeInTheDocument() );
		expect( connector.disconnectRemoteSite ).toHaveBeenCalledExactlyOnceWith(
			'spacefast',
			site.id,
			space.id
		);
		expect( connector.deleteSnapshot ).not.toHaveBeenCalled();

		const panel = await screen.findByRole( 'dialog', { name: /^(Share this WordPress|Share)$/ } );
		expect(
			within( panel ).queryByRole( 'link', { name: 'Open lente.space.fast' } )
		).not.toBeInTheDocument();
		if ( state !== 'selected' ) {
			expect( await screen.findByText( 'Not published yet' ) ).toBeVisible();
			expect( within( panel ).getByRole( 'combobox', { name: 'Destination' } ) ).toBeVisible();
			expect(
				within( panel ).getByRole( 'button', { name: 'Connect to an existing site' } )
			).toBeVisible();
		} else {
			expect( await screen.findByRole( 'link', { name: 'Open lente.blog' } ) ).toBeVisible();
		}
		if ( state === 'with preview' ) {
			await user.click( within( panel ).getByRole( 'button', { name: 'Previews' } ) );
			expect( await selectPreview( user, 'Preview 1' ) ).toHaveTextContent( preview.url );
		}
	}
);

it( 'treats an upgraded preview as its published destination without duplicating it', async () => {
	setup( {
		getSnapshots: async () => [ { ...preview, atomicSiteId: live.id } ],
		getRemoteSites: async ( provider ) => ( provider === 'wpcom' ? [ live ] : [] ),
	} );
	await open();
	expect( screen.getByRole( 'button', { name: 'Share…' } ) ).toBeVisible();
	expect( screen.queryByRole( 'button', { name: 'Choose destination' } ) ).not.toBeInTheDocument();
} );

it( 'restores the default for an unavailable destination and switches providers', async () => {
	localStorage.setItem( 'studio-last-publish-provider', 'unknown-provider' );
	const { connector, user } = setup( {
		getRemoteSites: async () => [],
		getSnapshots: async () => [],
	} );
	await open();
	expect( screen.getByRole( 'button', { name: 'Create preview' } ) ).toBeVisible();
	await user.click( screen.getByRole( 'combobox', { name: 'Destination' } ) );
	const choice = await screen.findByRole( 'option', {
		name: 'WordPress.com',
	} );
	expect( choice ).toHaveAttribute( 'aria-selected', 'true' );
	await user.click( screen.getByRole( 'option', { name: 'Spacefast' } ) );
	expect( await screen.findByRole( 'button', { name: 'Publish' } ) ).toBeVisible();
	expect( connector.createRemoteSite ).not.toHaveBeenCalled();
	await user.click( screen.getByRole( 'combobox', { name: 'Destination' } ) );
	await user.click( await screen.findByRole( 'option', { name: 'WordPress.com' } ) );
	expect( screen.getByRole( 'button', { name: 'Create preview' } ) ).toBeVisible();
	await waitFor( () =>
		expect( screen.queryByRole( 'option', { name: 'WordPress.com' } ) ).not.toBeInTheDocument()
	);
	expect( screen.queryByText( 'Some features may not work' ) ).not.toBeInTheDocument();
} );

it( 'opens provider settings from the account prompt when no providers are connected', async () => {
	const { connector, history } = setup( {
		getAuthUser: async () => null,
		getAiSettings: async () => aiSettings( 'wpcom', [] ),
		getRemoteSites: async () => [],
		getSnapshots: async () => [],
	} );
	fireEvent.click( await screen.findByRole( 'button', { name: 'Share…' } ) );
	await screen.findByRole( 'dialog', { name: 'Share your WordPress' } );
	expect( screen.getByRole( 'button', { name: 'Continue with WordPress.com' } ) ).toBeVisible();
	expect( screen.queryByRole( 'combobox', { name: 'Destination' } ) ).not.toBeInTheDocument();
	fireEvent.click( screen.getByRole( 'button', { name: 'Choose a different provider' } ) );
	await waitFor( () => expect( history.location.search ).toContain( 'settings=providers' ) );
	expect(
		screen.queryByRole( 'dialog', { name: 'Share your WordPress' } )
	).not.toBeInTheDocument();
	expect( screen.queryByRole( 'combobox', { name: 'Destination' } ) ).not.toBeInTheDocument();
	expect( connector.authenticate ).not.toHaveBeenCalled();
	expect( connector.publishPreviewSite ).not.toHaveBeenCalled();
} );
it( 'defaults to the connected destination even when a disconnected provider was used last', async () => {
	localStorage.setItem( 'studio-last-publish-provider', 'wpcom' );
	const { history, user } = setup( {
		getAuthUser: async () => null,
		getAiSettings: async () => aiSettings( 'wpcom', [ 'spacefast' ] ),
		getRemoteSites: async () => [],
		getSnapshots: async () => [],
	} );
	await open();
	expect( await screen.findByText( 'Spacefast' ) ).toBeVisible();
	expect( screen.queryByText( 'A static copy of your pages.' ) ).not.toBeInTheDocument();
	expect( screen.getByRole( 'combobox', { name: 'Destination' } ) ).toBeVisible();
	expect( screen.queryByText( 'WordPress.com' ) ).not.toBeInTheDocument();
	expect( screen.queryByRole( 'button', { name: 'Create preview' } ) ).not.toBeInTheDocument();
	expect(
		screen.queryByRole( 'dialog', { name: 'Share your WordPress' } )
	).not.toBeInTheDocument();
	await user.click( screen.getByRole( 'combobox', { name: 'Destination' } ) );
	expect( await screen.findByRole( 'option', { name: /Spacefast/ } ) ).toHaveAttribute(
		'aria-selected',
		'true'
	);
	expect( screen.getAllByRole( 'option', { selected: true } ) ).toHaveLength( 1 );
	await user.click( screen.getByRole( 'option', { name: 'Add more providers' } ) );
	await waitFor( () => expect( history.location.search ).toContain( 'settings=providers' ) );
} );

it.each( [ false, true ] )(
	'keeps first publish steady through creation and upload (with preview: %s)',
	async ( withPreview ) => {
		let connected = false;
		let published = false;
		let finishCreation!: ( value: typeof space ) => void;
		const creation = new Promise< typeof space >( ( resolve ) => {
			finishCreation = resolve;
		} );
		let finishUpload!: () => void;
		const upload = new Promise< void >( ( resolve ) => {
			finishUpload = resolve;
		} );
		const { connector, user } = setup( {
			getRemoteSites: async ( provider ) =>
				provider === 'spacefast' && connected
					? [ { ...space, lastPushTimestamp: published ? space.lastPushTimestamp : null } ]
					: [],
			getSnapshots: async () => ( withPreview ? [ preview ] : [] ),
			getSitePublishStatus: async () => ( { localChanged: ! published } ),
			createRemoteSite: async () => {
				const created = await creation;
				connected = true;
				return created;
			},
			pushSite: async () => {
				await upload;
				published = true;
			},
		} );
		const panel = await open();
		if ( withPreview ) {
			expect( within( panel ).getByRole( 'group', { name: 'Preview: Preview 1' } ) ).toBeVisible();
		}
		await user.click( within( panel ).getByRole( 'combobox', { name: 'Destination' } ) );
		await user.click( await screen.findByRole( 'option', { name: 'Spacefast' } ) );
		expect(
			within( panel ).queryByText( 'Forms, comments, and search may not work on a static site.' )
		).not.toBeInTheDocument();
		const publish = within( panel ).getByRole( 'button', { name: 'Publish' } );
		await waitFor( () => expect( publish ).toBeEnabled() );
		await user.click( publish );
		await waitFor( () =>
			expect( connector.createRemoteSite ).toHaveBeenCalledExactlyOnceWith(
				'spacefast',
				site.id,
				site.name,
				'private',
				false
			)
		);
		expect( within( panel ).getByRole( 'button', { name: 'Publishing…' } ) ).toBeVisible();
		finishCreation( space );
		await waitFor( () =>
			expect( connector.pushSite ).toHaveBeenCalledExactlyOnceWith(
				'spacefast',
				site.id,
				space.id,
				undefined
			)
		);
		expect( within( panel ).getByRole( 'heading', { name: 'Details' } ) ).toBeVisible();
		expect( within( panel ).getByRole( 'combobox', { name: 'Destination' } ) ).toBeDisabled();
		expect( within( panel ).getByRole( 'button', { name: 'Publishing…' } ) ).toBeVisible();
		expect(
			within( panel ).queryByRole( 'link', { name: 'Open lente.space.fast' } )
		).not.toBeInTheDocument();
		expect(
			within( panel ).queryByRole( 'button', { name: 'Manage domain' } )
		).not.toBeInTheDocument();
		finishUpload();
		expect(
			await within( panel ).findByRole(
				'link',
				{ name: 'Open lente.space.fast' },
				{ timeout: 4000 }
			)
		).toBeEnabled();
		expect(
			within( panel ).queryByRole( 'button', { name: 'Manage domain' } )
		).not.toBeInTheDocument();
		expect(
			within( panel ).queryByText( 'Forms, comments, and search may not work on a static site.' )
		).not.toBeInTheDocument();
		expect(
			within( panel ).queryByRole( 'button', { name: 'Switch previews' } )
		).not.toBeInTheDocument();
	}
);

it( 'creates the first preview from Actions on a published WordPress.com site', async () => {
	let previews: Snapshot[] = [];
	const { connector, user } = setup( {
		getRemoteSites: async ( provider ) => ( provider === 'wpcom' ? [ live ] : [] ),
		getSnapshots: async () => previews,
		publishPreviewSite: async () => {
			previews = [ preview ];
			return { url: preview.url };
		},
	} );
	const panel = await open();
	expect(
		within( panel ).queryByRole( 'button', { name: 'Create preview' } )
	).not.toBeInTheDocument();
	expect(
		within( panel ).queryByRole( 'button', { name: 'Switch previews' } )
	).not.toBeInTheDocument();
	const create = within( screen.getByRole( 'region', { name: 'Suggested' } ) ).getByRole(
		'button',
		{
			name: 'Create new preview',
		}
	);
	await waitFor( () => expect( create ).toBeEnabled() );
	await user.click( create );
	const previewsSection = within( await openPreviews( user ) );
	expect( await previewsSection.findByRole( 'button', { name: /^Preview 1/ } ) ).toBeVisible();
	expect( await previewsSection.findByRole( 'button', { name: 'New preview' } ) ).toBeVisible();
	await user.keyboard( '{Escape}' );
	await waitFor( () =>
		expect( screen.queryByRole( 'dialog', { name: 'Previews' } ) ).not.toBeInTheDocument()
	);
	expect(
		within( panel ).queryByRole( 'button', { name: 'Switch previews' } )
	).not.toBeInTheDocument();
	expect( within( panel ).getByRole( 'link', { name: 'Open lente.blog' } ) ).toBeVisible();
	expect( connector.publishPreviewSite ).toHaveBeenCalledExactlyOnceWith(
		site.id,
		undefined,
		undefined
	);
} );

it( 'copies a published link from the URL row and opens the site', async () => {
	const { connector, user } = setup( {
		getSitePublishStatus: async () => ( { localChanged: false } ),
	} );
	await open();
	await switchTo( 'lente.space.fast' );
	const row = await screen.findByRole( 'link', { name: 'Open lente.space.fast' } );
	await user.click( await screen.findByRole( 'button', { name: 'Copy link' } ) );
	await waitFor( () => expect( connector.copyText ).toHaveBeenCalledWith( space.url ) );
	fireEvent.click( row );
	expect( connector.openExternalUrl ).toHaveBeenCalledExactlyOnceWith( space.url );
} );

it( 'keeps the confirmed live state while destination metadata refreshes', async () => {
	const { connector, queryClient } = setup( {
		getRemoteSites: async ( provider ) => ( provider === 'wpcom' ? [ live ] : [] ),
		getSnapshots: async () => [],
	} );
	await open();
	await screen.findByRole( 'button', { name: 'Update…' } );
	let finish!: ( value: { localChanged: boolean } ) => void;
	connector.getSitePublishStatus.mockImplementation(
		() =>
			new Promise( ( resolve ) => {
				finish = resolve;
			} )
	);
	act( () => {
		queryClient.setQueryData( remoteSitesQueryKey( 'wpcom', site.id ), [
			{ ...live, lastPushTimestamp: new Date( Date.now() + 1000 ).toISOString() },
		] );
	} );
	await waitFor( () => expect( finish ).toBeDefined() );
	expect( screen.queryByText( 'Your latest changes are live.' ) ).not.toBeInTheDocument();
	expect( screen.getByRole( 'button', { name: 'Update…' } ) ).toBeVisible();
	expect( screen.getByText( 'No changes' ) ).toBeVisible();
	await act( async () => finish( { localChanged: false } ) );
} );

it.each( [ 'failed', 'pending' ] )(
	'keeps a known destination publishable when another provider lookup is %s',
	async ( state ) => {
		const { connector, user } = setup( {
			getRemoteSites: async ( provider ) => {
				if ( provider === 'wpcom' ) return [ live ];
				if ( state === 'pending' ) return new Promise( () => {} );
				throw new Error( 'Provider unavailable' );
			},
			listAccountSites: async () => {
				throw new Error( 'Account refresh failed' );
			},
			getSitePublishStatus: async () => ( { localChanged: true } ),
			getSnapshots: async () => [],
			pushSite: async () => new Promise( () => {} ),
		} );
		await open();
		const publish = await screen.findByRole( 'button', { name: 'Update…' } );
		await waitFor( () => expect( publish ).toBeEnabled() );
		expect( screen.queryByText( 'Could not check your connected sites.' ) ).not.toBeInTheDocument();
		expect( screen.queryByText( /Couldn’t load your .* sites/ ) ).not.toBeInTheDocument();
		await user.click( publish );
		await confirmPublish();
		await waitFor( () =>
			expect( connector.pushSite ).toHaveBeenCalledWith(
				'wpcom',
				site.id,
				live.id,
				expect.any( Object )
			)
		);
	}
);

it( 'retains a known destination after its saved connection refresh fails', async () => {
	const { connector, queryClient } = setup( {
		getRemoteSites: async ( provider ) => ( provider === 'wpcom' ? [ live ] : [] ),
		getSnapshots: async () => [],
		getSitePublishStatus: async () => ( { localChanged: true } ),
	} );
	await open();
	await waitFor( () => expect( screen.getByRole( 'button', { name: 'Update…' } ) ).toBeEnabled() );
	connector.getRemoteSites.mockRejectedValue( new Error( 'Refresh unavailable' ) );
	await act( async () => {
		await queryClient.invalidateQueries( { queryKey: remoteSitesQueryKey( 'wpcom', site.id ) } );
	} );
	expect( queryClient.getQueryState( remoteSitesQueryKey( 'wpcom', site.id ) )?.status ).toBe(
		'error'
	);
	expect( screen.getByRole( 'button', { name: 'Update…' } ) ).toBeEnabled();
	expect( screen.getByRole( 'link', { name: 'Open lente.blog' } ) ).toBeVisible();
	expect( screen.queryByText( /Couldn’t load your .* sites/ ) ).not.toBeInTheDocument();
} );

it( 'explains an unavailable destination and retries only that provider with visible progress', async () => {
	const { connector, user } = setup( {
		getRemoteSites: async ( provider ) => {
			if ( provider === 'wpcom' ) throw new Error( 'Saved connections unavailable' );
			return [];
		},
		getSnapshots: async () => [],
		getSitePublishStatus: async () => ( { localChanged: true } ),
	} );
	await open();
	const notice = await screen.findByRole( 'alert' );
	expect( notice ).toHaveTextContent( 'Couldn’t load your WordPress.com sites' );
	expect( notice ).toHaveTextContent(
		'Try again to see where this WordPress is already connected.'
	);
	expect( screen.getByRole( 'button', { name: 'Create preview' } ) ).toBeDisabled();
	const otherProviderCalls = connector.getRemoteSites.mock.calls.filter(
		( [ provider ] ) => provider === 'spacefast'
	).length;
	let finish!: ( sites: ( typeof live )[] ) => void;
	connector.getRemoteSites.mockImplementation(
		async () =>
			new Promise( ( resolve ) => {
				finish = resolve;
			} )
	);
	await user.click( within( notice ).getByRole( 'button', { name: 'Try again' } ) );
	expect( await within( notice ).findByRole( 'button', { name: 'Checking…' } ) ).toHaveAttribute(
		'aria-disabled',
		'true'
	);
	expect( notice ).toBeVisible();
	await act( async () => finish( [ live ] ) );
	await waitFor( () => expect( screen.getByRole( 'button', { name: 'Update…' } ) ).toBeEnabled() );
	expect( screen.queryByText( /Couldn’t load your .* sites/ ) ).not.toBeInTheDocument();
	expect(
		connector.getRemoteSites.mock.calls.filter( ( [ provider ] ) => provider === 'spacefast' )
	).toHaveLength( otherProviderCalls );
} );

it( 'holds publishing until the completed destination check returns', async () => {
	const { connector } = setup( {
		getRemoteSites: async ( provider ) => ( provider === 'spacefast' ? [ space ] : [] ),
		getSnapshots: async () => [],
		pushSite: async () => new Promise( () => {} ),
	} );
	await open();
	fireEvent.click( await screen.findByRole( 'button', { name: 'Update…' } ) );
	await confirmPublish();
	await screen.findByRole( 'button', { name: 'Updating…' } );
	expect( screen.getByText( 'Published just now' ) ).toBeVisible();
	act( () =>
		connector.emit( 'onSyncActivity', {
			siteId: site.id,
			activity: { kind: 'pending', direction: 'push', provider: 'spacefast' },
		} )
	);
	expect( screen.queryByText( 'Your changes will be live in a moment.' ) ).not.toBeInTheDocument();
	expect( screen.getByRole( 'button', { name: 'Updating…' } ) ).toBeVisible();
	expect( screen.queryByLabelText( 'Local changes' ) ).not.toBeInTheDocument();
	let finish!: ( value: { localChanged: boolean } ) => void;
	connector.getSitePublishStatus.mockImplementation(
		() =>
			new Promise( ( resolve ) => {
				finish = resolve;
			} )
	);
	act( () =>
		connector.emit( 'onSyncActivity', {
			siteId: site.id,
			activity: {
				kind: 'success',
				direction: 'push',
				provider: 'spacefast',
				remoteSiteId: space.id,
			},
		} )
	);
	await waitFor( () => expect( finish ).toBeDefined() );
	expect( screen.queryByText( 'Your changes will be live in a moment.' ) ).not.toBeInTheDocument();
	expect( screen.queryByRole( 'button', { name: 'Update…' } ) ).not.toBeInTheDocument();
	await act( async () => finish( { localChanged: false } ) );
	await screen.findByRole( 'button', { name: 'Update…' } );
	expect( screen.getByRole( 'button', { name: 'Update…' } ) ).toBeVisible();
} );

it( 'shows an actionable Publish changes button once publish checks finish', async () => {
	let finish!: ( value: number ) => void;
	setup( {
		getRemoteSites: async ( provider ) => ( provider === 'wpcom' ? [ live ] : [] ),
		getSnapshots: async () => [],
		getSitePublishStatus: async () => ( { localChanged: true } ),
		getDirectorySize: async () => new Promise( ( resolve ) => ( finish = resolve ) ),
	} );
	await open();
	await waitFor( () => expect( finish ).toBeDefined() );
	expect( screen.getByRole( 'button', { name: 'Checking…' } ) ).toBeVisible();
	expect( screen.queryByRole( 'button', { name: 'Update…' } ) ).not.toBeInTheDocument();
	await act( async () => finish( 1 ) );
	expect( await screen.findByRole( 'button', { name: 'Update…' } ) ).toBeEnabled();
} );

it.each( [ 'wpcom', 'spacefast' ] as const )(
	'shows the saved publish time for %s destinations',
	async ( provider ) => {
		setup( {
			getRemoteSites: async ( id ) =>
				id === provider
					? [
							{
								...( provider === 'wpcom' ? live : space ),
								lastPushTimestamp: new Date().toISOString(),
							},
					  ]
					: [],
			getSnapshots: async () => [],
			getSitePublishStatus: async () => ( { localChanged: false } ),
		} );
		await open();
		expect( await screen.findByText( 'Published just now' ) ).toBeVisible();
		expect( await screen.findByRole( 'button', { name: 'Update…' } ) ).toBeVisible();
		expect( screen.queryByText( 'Your latest changes are live.' ) ).not.toBeInTheDocument();
	}
);

it( 'publishes everything on the first WordPress.com push and offers selective updates afterward', async () => {
	let lastPushTimestamp: string | null = null;
	let finish!: () => void;
	const { connector, queryClient, user } = setup( {
		listAccountSites: async ( provider ) =>
			provider === 'wpcom' ? [ { ...live, launchStatus: 'unlaunched' } ] : [],
		getRemoteSites: async ( provider ) =>
			provider === 'wpcom'
				? [ { ...live, lastPushTimestamp, launchAfterPush: true, launchStatus: 'unlaunched' } ]
				: [],
		getSnapshots: async () => [],
		getSitePublishStatus: async () => ( { localChanged: false } ),
		pushSite: async () => {
			await new Promise< void >( ( resolve ) => ( finish = resolve ) );
			lastPushTimestamp = live.lastPushTimestamp;
		},
	} );
	queryClient.setQueryData( [ 'publish-selection', site.id, 'wpcom', live.id, 'push' ], {
		scope: 'files',
		nodes: [],
		content: false,
	} );
	await open();
	expect( await screen.findByText( 'Not published yet' ) ).toBeVisible();
	expect( screen.getByLabelText( 'Local changes' ) ).toBeVisible();
	expect( screen.queryByRole( 'button', { name: 'What to publish' } ) ).not.toBeInTheDocument();
	const publish = screen.getByRole( 'button', { name: 'Update' } );
	await waitFor( () => expect( publish ).toBeEnabled() );
	await user.click( publish );
	expect( await screen.findByRole( 'button', { name: 'Updating…' } ) ).toBeVisible();
	expect( connector.pushSite ).toHaveBeenCalledExactlyOnceWith( 'wpcom', site.id, live.id, {
		optionsToSync: [ 'all' ],
	} );
	await act( async () => finish() );
	act( () =>
		connector.emit( 'onSyncActivity', {
			siteId: site.id,
			activity: { kind: 'success', direction: 'push', provider: 'wpcom', remoteSiteId: live.id },
		} )
	);
	expect( screen.queryByRole( 'button', { name: 'What to publish' } ) ).not.toBeInTheDocument();
	expect( screen.queryByLabelText( 'Local changes' ) ).not.toBeInTheDocument();
	await user.click( await screen.findByRole( 'button', { name: 'Update…' } ) );
	const confirmation = await screen.findByRole( 'alertdialog', {
		name: /Publish (again|changes)\?/,
	} );
	expect(
		within( confirmation ).getByRole( 'button', { name: 'What to publish' } )
	).toHaveAccessibleDescription( 'Files only' );
} );

it( 'uses a neutral state for a destination with no transfer history', async () => {
	let lastPushTimestamp: string | null = null;
	let finish!: () => void;
	const { connector, user } = setup( {
		getRemoteSites: async ( provider ) =>
			provider === 'spacefast' ? [ { ...space, lastPushTimestamp } ] : [],
		listAccountSites: async () => [],
		getSiteVisibility: async () => ( { url: space.url, visibility: 'public' } ),
		getSnapshots: async () => [],
		getSitePublishStatus: async () => ( { localChanged: lastPushTimestamp ? true : null } ),
		pushSite: async () => {
			await new Promise< void >( ( resolve ) => ( finish = resolve ) );
			lastPushTimestamp = space.lastPushTimestamp;
		},
	} );
	const panel = await open();
	expect( within( panel ).getByRole( 'heading', { name: 'Details' } ) ).toBeVisible();
	expect( within( panel ).getByRole( 'button', { name: 'Site actions' } ) ).toBeVisible();
	expect( within( panel ).queryByRole( 'button', { name: 'Copy link' } ) ).not.toBeInTheDocument();
	expect(
		await within( panel ).findByRole( 'link', { name: 'Open lente.space.fast' } )
	).toBeVisible();
	expect( within( panel ).queryByText( 'Not published yet' ) ).not.toBeInTheDocument();
	expect( screen.queryByLabelText( 'Local changes' ) ).not.toBeInTheDocument();
	await user.click( within( panel ).getByRole( 'button', { name: 'Update…' } ) );
	await confirmPublish();
	expect( await screen.findByRole( 'button', { name: 'Updating…' } ) ).toBeVisible();
	expect( connector.pushSite ).toHaveBeenCalledExactlyOnceWith(
		'spacefast',
		site.id,
		space.id,
		undefined
	);
	await act( async () => finish() );
	act( () =>
		connector.emit( 'onSyncActivity', {
			siteId: site.id,
			activity: {
				kind: 'success',
				direction: 'push',
				provider: 'spacefast',
				remoteSiteId: space.id,
			},
		} )
	);
	expect( await screen.findByRole( 'button', { name: 'Update…' } ) ).toBeVisible();
} );

it( 'hides the publish-time line when no timestamp was saved', async () => {
	setup( {
		getRemoteSites: async ( provider ) =>
			provider === 'wpcom' ? [ { ...live, lastPushTimestamp: '' } ] : [],
		getSnapshots: async () => [],
	} );
	await open();
	await screen.findByRole( 'button', { name: 'Update…' } );
	expect( screen.queryByText( 'Not published yet' ) ).not.toBeInTheDocument();
	expect( document.querySelector( 'time' ) ).not.toBeInTheDocument();
} );

it.each( [ false, true ] )(
	'uses the comparison after pulling an existing site before its first push: %s',
	async ( localChanged ) => {
		setup( {
			getRemoteSites: async ( provider ) =>
				provider === 'wpcom'
					? [ { ...live, lastPushTimestamp: null, lastPullTimestamp: new Date().toISOString() } ]
					: [],
			getSnapshots: async () => [],
			getSitePublishStatus: async () => ( { localChanged } ),
		} );
		const panel = await open();
		expect(
			await within( panel ).findByRole( 'button', {
				name: 'Update…',
			} )
		).toBeVisible();
		expect( screen.queryByText( 'Not published yet' ) ).not.toBeInTheDocument();
		expect( document.querySelector( 'time' ) ).not.toBeInTheDocument();
		if ( localChanged ) {
			expect( screen.getByLabelText( 'Local changes' ) ).toBeVisible();
		} else {
			expect( screen.queryByLabelText( 'Local changes' ) ).not.toBeInTheDocument();
		}
	}
);

it( 'keeps first-preview creation in the primary button and offers existing sites', async () => {
	const { user } = setup( { getRemoteSites: async () => [], getSnapshots: async () => [] } );
	const panel = await open();
	expect( within( panel ).getByRole( 'button', { name: 'Create preview' } ) ).toBeVisible();
	expect(
		within( panel ).queryByRole( 'button', { name: 'More options' } )
	).not.toBeInTheDocument();
	await user.click( await screen.findByRole( 'combobox', { name: 'Destination' } ) );
	const menu = await screen.findByRole( 'listbox' );
	const choices = within( menu );
	const [ wordpress, spacefast ] = choices.getAllByRole( 'option' );
	expect( wordpress ).toHaveAccessibleName( 'WordPress.com' );
	expect( wordpress ).toHaveAccessibleDescription( 'The full WordPress, with a domain.' );
	expect( spacefast ).toHaveAccessibleName( 'Spacefast' );
	expect( spacefast ).toHaveAccessibleDescription( 'A static copy of your pages.' );
	expect( choices.getAllByRole( 'option' ) ).toHaveLength( 2 );
	expect( choices.queryByRole( 'option', { name: 'Add more providers' } ) ).not.toBeInTheDocument();
	await user.keyboard( '{Escape}' );
	await user.click(
		within( panel ).getByRole( 'button', { name: 'Connect to an existing site' } )
	);
	const step = await screen.findByRole( 'dialog', { name: 'Choose an existing site' } );
	expect( step ).toBe( panel );
	expect( within( step ).getByRole( 'button', { name: 'Back' } ) ).toHaveFocus();
	await user.keyboard( '{Escape}' );
	const connect = await within( panel ).findByRole( 'button', {
		name: 'Connect to an existing site',
	} );
	await waitFor( () => expect( connect ).toHaveFocus() );
} );

it.each( [ false, true ] )(
	'connects an existing live site without transferring when a preview exists: %s',
	async ( hasPreview ) => {
		let connected = false;
		const destination = { ...live, lastPushTimestamp: null };
		const { connector, user } = setup( {
			getSnapshots: async () => ( hasPreview ? [ preview ] : [] ),
			getRemoteSites: async ( provider ) =>
				provider === 'wpcom' && connected ? [ destination ] : [],
			listAccountSites: async ( provider ) => ( provider === 'wpcom' ? [ destination ] : [] ),
			getSitePublishStatus: async () => ( { localChanged: null } ),
			connectRemoteSite: async () => {
				connected = true;
			},
		} );
		await open();
		await user.click(
			await screen.findByRole( 'button', {
				name: 'Connect to an existing site',
			} )
		);
		const dialog = await screen.findByRole( 'dialog', { name: 'Choose an existing site' } );
		await user.click( await within( dialog ).findByRole( 'button', { name: /Live.*lente.blog/ } ) );
		expect( await screen.findByRole( 'button', { name: 'Update…' } ) ).toBeVisible();
		expect( screen.getByRole( 'link', { name: 'Open lente.blog' } ) ).toBeVisible();
		expect( screen.queryByText( 'Not published yet' ) ).not.toBeInTheDocument();
		expect( screen.queryByLabelText( 'Local changes' ) ).not.toBeInTheDocument();
		expect( connector.connectRemoteSite ).toHaveBeenCalledExactlyOnceWith(
			'wpcom',
			site.id,
			destination
		);
		expect( connector.trackEvent ).toHaveBeenCalledWith(
			TRACKS_EVENTS.SYNC_CONNECT,
			{ success: true, num_of_sites: 1, sync_type: 'wpcom' },
			site.id
		);
		expect( connector.pushSite ).not.toHaveBeenCalled();
		expect( connector.pullSite ).not.toHaveBeenCalled();
	}
);

it( 'preserves selective publishing on the first push to an existing live site', async () => {
	const destination = { ...live, lastPushTimestamp: null };
	const { connector, user } = setup( {
		getRemoteSites: async ( provider ) => ( provider === 'wpcom' ? [ destination ] : [] ),
		listAccountSites: async ( provider ) => ( provider === 'wpcom' ? [ destination ] : [] ),
		getSitePublishStatus: async () => ( { localChanged: null } ),
	} );
	await open();
	const warning = /Publishing the database replaces/;
	expect( screen.queryByText( warning ) ).not.toBeInTheDocument();
	await user.click( await screen.findByRole( 'button', { name: 'Update…' } ) );
	const all = await screen.findByRole( 'alertdialog', { name: 'Publish changes?' } );
	expect( all ).toHaveTextContent( 'Publish to lente.blog.' );
	const scope = within( all ).getByRole( 'button', { name: 'What to publish' } );
	expect( scope ).toHaveAccessibleDescription( 'Everything' );
	expect( within( all ).getByText( warning ) ).toBeVisible();
	const publish = within( all ).getByRole( 'button', { name: 'Publish changes' } );
	expect( publish ).toHaveAccessibleDescription( warning );
	await user.click( scope );
	await user.click( await screen.findByRole( 'checkbox', { name: /Database/ } ) );
	await user.keyboard( '{Escape}' );
	expect( all ).toBeVisible();
	expect( scope ).toHaveAccessibleDescription( 'Files only' );
	expect( within( all ).queryByText( warning ) ).not.toBeInTheDocument();
	expect( publish ).not.toHaveAccessibleDescription( warning );
	expect( connector.pushSite ).not.toHaveBeenCalled();
	await confirmPublish();
	expect( connector.pushSite ).toHaveBeenCalledWith(
		'wpcom',
		site.id,
		live.id,
		expect.objectContaining( {
			optionsToSync: expect.not.arrayContaining( [ 'all' ] ),
		} )
	);
	expect( connector.pushSite.mock.calls[ 0 ][ 3 ]?.optionsToSync ).not.toContain( 'sqls' );
} );

it( 'can reduce an oversized publish selection in the confirmation', async () => {
	const { connector, user } = setup( {
		getSitePublishStatus: async () => ( { localChanged: true } ),
		getDirectorySize: async ( _siteId, path ) => ( path.length === 1 ? 6 * 1024 ** 3 : 1 ),
	} );
	await open();
	await user.click( await screen.findByRole( 'button', { name: 'Update…' } ) );
	const confirmation = await screen.findByRole( 'alertdialog', { name: 'Publish changes?' } );
	const warning = /exceeds the 5 GB publishing limit/;
	expect( await within( confirmation ).findByText( warning ) ).toBeVisible();
	expect(
		within( confirmation ).getByRole( 'button', { name: 'Publish changes' } )
	).toBeDisabled();
	await user.click( within( confirmation ).getByRole( 'button', { name: 'What to publish' } ) );
	await user.click( await screen.findByRole( 'checkbox', { name: /Database/ } ) );
	await user.keyboard( '{Escape}' );
	await waitFor( () =>
		expect(
			within( confirmation ).getByRole( 'button', { name: 'Publish changes' } )
		).toBeEnabled()
	);
	expect( within( confirmation ).queryByText( warning ) ).not.toBeInTheDocument();
	expect( connector.pushSite ).not.toHaveBeenCalled();
} );

it( 'waits for the exact pull destination requested before connections load', async () => {
	const destination = { ...live, id: 43, url: 'https://staging.lente.blog' };
	let resolveConnections!: ( sites: ( typeof live )[] ) => void;
	const connections = new Promise< ( typeof live )[] >( ( resolve ) => {
		resolveConnections = resolve;
	} );
	const { connector, user } = setup( {
		getRemoteSites: async ( provider ) => ( provider === 'wpcom' ? connections : [ space ] ),
		listAccountSites: async ( provider ) =>
			provider === 'wpcom' ? [ live, destination ] : [ space ],
	} );
	act( () =>
		requestHeaderPanel( {
			panel: 'publish',
			siteId: site.id,
			view: 'pull',
			provider: 'wpcom',
			remoteSiteId: destination.id,
		} )
	);
	expect( screen.queryByRole( 'alertdialog' ) ).not.toBeInTheDocument();
	await act( async () => resolveConnections( [ live, destination ] ) );
	const dialog = await screen.findByRole( 'alertdialog', {
		name: 'Update local site from staging.lente.blog?',
	} );
	expect( dialog ).toHaveTextContent( 'what’s on staging.lente.blog.' );
	await user.click( within( dialog ).getByRole( 'button', { name: 'Replace selected content' } ) );
	expect( connector.pullSite ).toHaveBeenCalledWith(
		'wpcom',
		site.id,
		destination.id,
		expect.anything()
	);
} );

it( 'chooses a live site before creating a preview when several sites qualify', async () => {
	const another = { ...live, id: 43, name: 'Another live site', url: 'https://other.blog' };
	const { connector, user } = setup( {
		getRemoteSites: async ( provider ) => ( provider === 'wpcom' ? [ live, another ] : [] ),
		listAccountSites: async ( provider ) => ( provider === 'wpcom' ? [ live, another ] : [] ),
	} );
	await open();
	await openPreviews( user );
	await user.click( await screen.findByRole( 'button', { name: 'New preview' } ) );
	const dialog = await screen.findByRole( 'dialog', { name: 'Live site' } );
	const select = within( dialog ).getByRole( 'combobox', { name: 'Live site' } );
	expect( select ).toHaveTextContent( 'None' );
	expect( connector.publishPreviewSite ).not.toHaveBeenCalled();
	await user.click( select );
	await user.click( await screen.findByRole( 'option', { name: 'Another live site' } ) );
	await user.click( within( dialog ).getByRole( 'button', { name: 'Create preview' } ) );
	await waitFor( () =>
		expect( connector.publishPreviewSite ).toHaveBeenCalledExactlyOnceWith(
			site.id,
			undefined,
			undefined,
			'43'
		)
	);
} );

it( 'chooses files in a modal, preserves Database, and discards unfinished edits', async () => {
	let readDelay = 0;
	const { connector, user } = setup( {
		getSitePublishStatus: async () => ( { localChanged: true } ),
		listLocalFileTree: async () => {
			await new Promise( ( resolve ) => setTimeout( resolve, readDelay ) );
			return [
				{
					name: 'themes',
					path: 'wp-content/themes',
					isDirectory: true,
					children: [
						{ name: 'style.css', path: 'wp-content/themes/site/style.css', isDirectory: false },
						{ name: 'theme.json', path: 'wp-content/themes/site/theme.json', isDirectory: false },
					],
				},
			];
		},
	} );
	await open();
	await user.click( await screen.findByRole( 'button', { name: 'Update…' } ) );
	const confirmation = () => screen.findByRole( 'alertdialog', { name: 'Publish changes?' } );
	await user.click(
		within( await confirmation() ).getByRole( 'button', { name: 'What to publish' } )
	);
	const database = await screen.findByRole( 'checkbox', {
		name: 'Database Posts, pages, and settings',
	} );
	await waitFor( () => expect( database ).toBeEnabled() );
	await user.click( database );
	const openFiles = async () => {
		if ( ! screen.queryByRole( 'button', { name: 'Choose specific files' } ) ) {
			await user.click( screen.getByRole( 'button', { name: 'What to publish' } ) );
		}
		const chooseFiles = await screen.findByRole( 'button', { name: 'Choose specific files' } );
		await waitFor( () => expect( chooseFiles ).toBeEnabled() );
		// The dialog lists the files it already knows while it reads them again.
		readDelay = 200;
		await user.click( chooseFiles );
		readDelay = 0;
		const view = await screen.findByRole( 'dialog', { name: 'Choose files' } );
		expect(
			screen.queryByRole( 'alertdialog', { name: 'Publish changes?' } )
		).not.toBeInTheDocument();
		expect(
			within( view ).queryByRole( 'checkbox', { name: 'Content and settings' } )
		).not.toBeInTheDocument();
		await user.click( within( view ).getByRole( 'button', { name: 'Expand themes' } ) );
		return view;
	};
	let dialog = await openFiles();
	await user.click( await within( dialog ).findByRole( 'checkbox', { name: 'theme.json' } ) );
	await user.click( within( dialog ).getByRole( 'button', { name: 'Done' } ) );
	await waitFor( () =>
		expect( screen.getByRole( 'button', { name: 'What to publish' } ) ).toHaveFocus()
	);
	await user.click( screen.getByRole( 'button', { name: 'What to publish' } ) );
	expect(
		screen.getByRole( 'checkbox', { name: 'Database Posts, pages, and settings' } )
	).not.toBeChecked();
	expect( screen.getByRole( 'checkbox', { name: 'Themes' } ) ).toBePartiallyChecked();
	expect( connector.pushSite ).not.toHaveBeenCalled();
	dialog = await openFiles();
	await user.click( await within( dialog ).findByRole( 'checkbox', { name: 'theme.json' } ) );
	await user.click( within( dialog ).getByRole( 'button', { name: 'Close' } ) );
	dialog = await openFiles();
	expect(
		await within( dialog ).findByRole( 'checkbox', { name: 'theme.json' } )
	).not.toBeChecked();
	await user.click( await within( dialog ).findByRole( 'checkbox', { name: 'style.css' } ) );
	expect( within( dialog ).getByRole( 'button', { name: 'Done' } ) ).toBeDisabled();
	await user.click( await within( dialog ).findByRole( 'checkbox', { name: 'theme.json' } ) );
	await user.keyboard( '{Escape}' );
	await confirmPublish();
	await waitFor( () =>
		expect( connector.pushSite ).toHaveBeenCalledExactlyOnceWith( 'wpcom', site.id, live.id, {
			optionsToSync: [ 'themes' ],
			specificSelectionPaths: [ 'themes/site/style.css' ],
		} )
	);
} );

it( 'warns before publishing changes newer than the linked preview', async () => {
	const linked = { ...preview, liveSiteId: live.id, versionId: 'old-version' };
	const { connector, user } = setup( {
		getSnapshots: async () => [ linked ],
		getSitePublishStatus: async () => ( { localChanged: true } ),
		getPreviewStatus: async () => ( {
			localSiteId: site.id,
			localChanged: true,
			previewChanged: false,
		} ),
	} );
	await open();
	const previews = await openPreviews( user );
	expect( await within( previews ).findByText( preview.url ) ).toBeVisible();
	await user.click( within( previews ).getByRole( 'button', { name: 'Back' } ) );
	await user.click( await screen.findByRole( 'button', { name: 'Update…' } ) );
	const dialog = await screen.findByRole( 'alertdialog', { name: 'Publish changes?' } );
	expect(
		await within( dialog ).findByText( /including changes not shown in that preview/ )
	).toBeVisible();
	expect( connector.pushSite ).not.toHaveBeenCalled();
} );

it( 'retries a delayed checkout connection without reopening the browser', async () => {
	let connected = false;
	const destination = {
		...live,
		lastPushTimestamp: null,
		launchAfterPush: true,
		launchStatus: 'unlaunched' as const,
	};
	const { connector, user } = setup( {
		getRemoteSites: async ( provider ) =>
			provider === 'wpcom' && connected ? [ destination ] : [],
		listAccountSites: async () => [],
		connectRemoteSite: async () => {
			connected = true;
		},
	} );
	await open();
	await user.click( screen.getByRole( 'combobox', { name: 'Who can view' } ) );
	await user.click( await screen.findByRole( 'option', { name: 'Everyone' } ) );
	await user.click( screen.getByRole( 'button', { name: 'Continue on WordPress.com' } ) );
	await waitFor( () => expect( connector.openExternalUrl ).toHaveBeenCalledTimes( 1 ) );
	act( () =>
		connector.emit( 'onSyncConnectSite', {
			studioSiteId: site.id,
			remoteSiteId: live.id,
			autoOpenPush: true,
		} )
	);
	const retry = await screen.findByRole( 'button', { name: 'Try again' } );
	connector.listAccountSites.mockResolvedValue( [ destination ] );
	await user.click( retry );
	expect( await screen.findByRole( 'button', { name: 'Update' } ) ).toBeVisible();
	expect( connector.openExternalUrl ).toHaveBeenCalledTimes( 1 );
	expect( connector.pushSite ).not.toHaveBeenCalled();
} );

it( 'uses the shared visibility picker with Spacefast options and saves restricted access', async () => {
	const { user, connector } = setup( {
		setSiteVisibility: async () => ( { visibility: 'private', url: space.url } ),
	} );
	await open();
	await switchTo( 'lente.space.fast' );
	await user.click( screen.getByRole( 'combobox', { name: 'Who can view' } ) );
	expect( await screen.findByRole( 'option', { name: 'Everyone', selected: true } ) ).toBeVisible();
	expect( screen.getByRole( 'option', { name: 'Restricted' } ) ).toHaveAccessibleDescription(
		'Your team and people you give access to'
	);
	expect( screen.queryByText( 'Visitors see a coming soon page' ) ).not.toBeInTheDocument();
	await user.click( screen.getByRole( 'option', { name: 'Manage on Spacefast' } ) );
	expect( connector.openExternalUrl ).toHaveBeenCalledWith(
		'https://my.spacefast.com/studio/lente/access'
	);
	await user.click( screen.getByRole( 'combobox', { name: 'Who can view' } ) );
	await user.click( await screen.findByRole( 'option', { name: 'Restricted' } ) );
	await waitFor( () =>
		expect( connector.setSiteVisibility ).toHaveBeenCalledWith( 'spacefast', space.id, 'private' )
	);
	await waitFor( () =>
		expect( screen.getByRole( 'combobox', { name: 'Who can view' } ) ).toHaveAccessibleDescription(
			'Restricted'
		)
	);
} );

it( 'disables unsupported access changes but leaves provider management available', async () => {
	const { user } = setup( {
		getSiteVisibility: async ( provider ) => ( {
			visibility: 'unknown',
			url: provider === 'spacefast' ? space.url : live.url,
			availableValues: [],
			message: 'Manage these access rules on Spacefast.',
		} ),
	} );
	await open();
	await switchTo( 'lente.space.fast' );
	await user.click( screen.getByRole( 'combobox', { name: 'Who can view' } ) );
	for ( const option of await screen.findAllByRole( 'option', {
		name: /^(Only you|Everyone|Invited people|Restricted)$/,
	} ) )
		expect( option ).toHaveAttribute( 'aria-disabled', 'true' );
	expect( screen.getByRole( 'option', { name: 'Manage on Spacefast' } ) ).not.toHaveAttribute(
		'aria-disabled',
		'true'
	);
} );

it( 'confirms Update even when the published site has no changes', async () => {
	const { user } = setup();
	await open();
	await user.click( await screen.findByRole( 'button', { name: 'Update…' } ) );
	expect( await screen.findByRole( 'alertdialog', { name: 'Publish again?' } ) ).toBeVisible();
} );

it( 'keeps preview creation available during a background availability refresh', async () => {
	const { connector, queryClient } = setup( {
		getSnapshots: async () => [],
		getRemoteSites: async () => [],
	} );
	await open();
	const button = await screen.findByRole( 'button', { name: 'Create preview' } );
	await waitFor( () => expect( button ).toBeEnabled() );
	connector.getSnapshotUsage.mockImplementationOnce( () => new Promise( () => {} ) );
	act( () => {
		void queryClient.invalidateQueries( { queryKey: SNAPSHOT_USAGE_QUERY_KEY } );
	} );
	await waitFor( () =>
		expect( queryClient.isFetching( { queryKey: SNAPSHOT_USAGE_QUERY_KEY } ) ).toBeGreaterThan( 0 )
	);
	expect( button ).toBeEnabled();
} );

it.each( [ 1, 2 ] )(
	'shows the preview selector only for multiple previews (%s)',
	async ( count ) => {
		const { user } = setup( {
			getRemoteSites: async () => [],
			getSnapshots: async () =>
				count === 1
					? [ preview ]
					: [ preview, { ...preview, atomicSiteId: 456, url: 'second.wpcomstaging.com' } ],
		} );
		await open();
		expect(
			screen.queryByRole( 'button', { name: 'Choose destination' } )
		).not.toBeInTheDocument();
		expect( !! screen.queryByRole( 'button', { name: 'Switch previews' } ) ).toBe( count > 1 );
		const menu = await openPreviews( user );
		expect( within( menu ).getByRole( 'button', { name: 'New preview' } ) ).toBeEnabled();
	}
);

it( 'keeps the preview switcher hidden while creating a second preview', async () => {
	const { user } = setup( {
		getRemoteSites: async () => [],
		publishPreviewSite: () => new Promise( () => {} ),
	} );
	await open();
	expect( screen.queryByRole( 'button', { name: 'Switch previews' } ) ).not.toBeInTheDocument();
	const menu = await openPreviews( user );
	await user.click( within( menu ).getByRole( 'button', { name: 'New preview' } ) );
	await user.click( within( menu ).getByRole( 'button', { name: 'Back' } ) );
	await waitFor( () =>
		expect( screen.queryByRole( 'dialog', { name: 'Previews' } ) ).not.toBeInTheDocument()
	);
	expect( document.querySelector( '[data-slot="preview-row-skeleton"]' ) ).toBeInTheDocument();
	expect( screen.queryByRole( 'button', { name: 'Switch previews' } ) ).not.toBeInTheDocument();
} );

it( 'keeps preview controls consistent while updating a preview', async () => {
	let finish!: ( result: { url: string } ) => void;
	const { user, connector } = setup( {
		getRemoteSites: async () => [],
		getSnapshots: async () => [
			preview,
			{ ...preview, atomicSiteId: 456, url: 'second.wpcomstaging.com', date: preview.date - 1000 },
		],
		publishPreviewSite: () =>
			new Promise( ( resolve ) => {
				finish = resolve;
			} ),
	} );
	const panel = await open();
	const controls = within( panel );
	const switcher = controls.getByRole( 'button', { name: 'Switch previews' } );
	const previewActions = controls.getByRole( 'button', { name: 'Preview actions' } );
	const access = controls.getByRole( 'combobox', { name: 'Who can view' } );
	const domain = controls.getByRole( 'button', { name: 'Get a free domain' } );
	const create = controls.getByRole( 'button', { name: 'Create new preview' } );
	const copy = controls.getByRole( 'button', { name: 'Copy link' } );
	await user.click( controls.getByRole( 'button', { name: 'Update' } ) );
	await waitFor( () => expect( connector.publishPreviewSite ).toHaveBeenCalledOnce() );
	for ( const control of [ switcher, access, domain, create ] ) {
		expect( control ).toBeDisabled();
	}
	expect( previewActions ).toHaveAttribute( 'aria-disabled', 'true' );
	expect( copy ).toBeEnabled();
	await user.click( copy );
	expect( connector.copyText ).toHaveBeenCalledWith( preview.shareUrl );
	await act( () => finish( { url: preview.url } ) );
	await waitFor( () => {
		for ( const control of [ switcher, access, domain, create ] ) {
			expect( control ).toBeEnabled();
		}
		expect( previewActions ).not.toHaveAttribute( 'aria-disabled', 'true' );
	} );
} );

it( 'searches existing sites and explains unavailable destinations in the shared picker', async () => {
	const unavailable = {
		...live,
		id: 99,
		name: 'Unavailable blog',
		syncSupport: 'missing-permissions' as const,
	};
	const { user, connector } = setup( {
		getRemoteSites: async () => [],
		getSnapshots: async () => [],
		listAccountSites: async ( provider ) => ( provider === 'wpcom' ? [ live, unavailable ] : [] ),
	} );
	await open();
	await user.click( await screen.findByRole( 'button', { name: 'Connect to an existing site' } ) );
	const dialog = await screen.findByRole( 'dialog', { name: 'Choose an existing site' } );
	expect(
		await within( dialog ).findByRole( 'button', { name: /^Unavailable blog / } )
	).toBeDisabled();
	await user.type(
		within( dialog ).getByRole( 'searchbox', { name: 'Search sites' } ),
		'Unavailable'
	);
	expect( within( dialog ).queryByRole( 'button', { name: /^Live / } ) ).not.toBeInTheDocument();
	expect( within( dialog ).getByRole( 'heading', { name: 'Unavailable' } ) ).toBeVisible();
	await user.click( within( dialog ).getByRole( 'button', { name: 'Open Unavailable blog' } ) );
	expect( connector.openExternalUrl ).toHaveBeenCalledExactlyOnceWith( unavailable.url );
	expect( dialog ).toBeVisible();
	expect( connector.connectRemoteSite ).not.toHaveBeenCalled();
} );

it( 'finds and connects a Space from a WordPress.com preview', async () => {
	const linkedSpace = {
		...space,
		id: 'spc_linked',
		name: 'Already connected',
		url: 'https://linked.space.fast',
		localSiteId: 'other-local-site',
	};
	const { user, connector } = setup( {
		getRemoteSites: async ( provider, localSiteId ) =>
			provider === 'spacefast' && ! localSiteId ? [ linkedSpace ] : [],
		listAccountSites: async ( provider ) =>
			provider === 'wpcom' ? [ live ] : [ space, linkedSpace ],
		connectRemoteSite: async () => {
			connector.getRemoteSites.mockImplementation( async ( provider, localSiteId ) =>
				provider === 'spacefast' ? ( localSiteId ? [ space ] : [ space, linkedSpace ] ) : []
			);
		},
	} );
	const panel = await open();
	expect(
		await within( panel ).findByRole( 'group', { name: 'Preview: Preview 1' } )
	).toBeVisible();
	await user.click( await screen.findByRole( 'button', { name: 'Connect to an existing site' } ) );
	const dialog = within( await screen.findByRole( 'dialog', { name: 'Choose an existing site' } ) );
	const wpcomRow = await dialog.findByRole( 'button', { name: /Live.*lente.blog/ } );
	const spacefastRow = await dialog.findByRole( 'button', { name: /Static.*lente.space.fast/ } );
	expect( wpcomRow ).toHaveAccessibleDescription( 'WordPress.com' );
	expect( spacefastRow ).toHaveAccessibleDescription( 'Spacefast' );
	expect( spacefastRow ).toContainHTML( getProvider( 'spacefast' ).logo! );
	expect( dialog.queryByRole( 'button', { name: /Already connected/ } ) ).not.toBeInTheDocument();
	await user.type( dialog.getByRole( 'searchbox', { name: 'Search sites' } ), 'Spacefast' );
	expect( wpcomRow ).not.toBeInTheDocument();
	await user.click( spacefastRow );
	expect( await screen.findByRole( 'link', { name: 'Open lente.space.fast' } ) ).toBeVisible();
	expect( connector.connectRemoteSite ).toHaveBeenCalledExactlyOnceWith(
		'spacefast',
		site.id,
		space
	);
	expect( connector.pushSite ).not.toHaveBeenCalled();
	expect( connector.pullSite ).not.toHaveBeenCalled();
} );

it( 'keeps available sites selectable when another provider cannot load', async () => {
	const { user } = setup( {
		getRemoteSites: async () => [],
		listAccountSites: async ( provider ) => {
			if ( provider === 'spacefast' ) throw new Error( 'Provider unavailable' );
			return [ live ];
		},
	} );
	await open();
	await user.click( await screen.findByRole( 'button', { name: 'Connect to an existing site' } ) );
	const dialog = within( await screen.findByRole( 'dialog', { name: 'Choose an existing site' } ) );
	expect( await dialog.findByRole( 'alert' ) ).toHaveTextContent(
		'Could not load Spacefast sites.'
	);
	expect( dialog.getByRole( 'button', { name: /Live.*lente.blog/ } ) ).toBeEnabled();
} );

it( 'opens a replacement destination without disconnecting the current site', async () => {
	const { user, connector } = setup( {
		getRemoteSites: async ( provider ) => ( provider === 'wpcom' ? [ live ] : [] ),
		getSnapshots: async () => [],
	} );
	await open();
	const actions = await openSiteActions( user );
	await user.click( within( actions ).getByRole( 'menuitem', { name: 'Change destination…' } ) );
	expect( screen.getByText( /Your current site stays online/ ) ).toBeVisible();
	expect( screen.getByRole( 'combobox', { name: 'Destination' } ) ).toBeVisible();
	await user.click( screen.getByRole( 'button', { name: 'Connect to an existing site' } ) );
	expect( await screen.findByRole( 'dialog', { name: 'Choose an existing site' } ) ).toBeVisible();
	expect( connector.disconnectRemoteSite ).not.toHaveBeenCalled();
	expect( connector.connectRemoteSite ).not.toHaveBeenCalled();
} );
