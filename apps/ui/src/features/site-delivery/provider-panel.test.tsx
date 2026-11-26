import { SNAPSHOT_EVENTS } from '@studio/common/lib/cli-events';
import { TRACKS_EVENTS } from '@studio/common/lib/record-tracks-event';
import { getProvider } from '@studio/providers';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, it, onTestFinished, vi } from 'vitest';
import { getVisibleToasts, runNoticeAction } from '@/data/app-messages';
import { buildPublishCheckoutUrl } from '@/data/core/connectors/publish-checkout-url';
import { publishTargetQueryKey, remoteSitesQueryKey } from '@/data/queries/use-remote-sites';
import {
	SNAPSHOTS_QUERY_KEY,
	SNAPSHOT_USAGE_QUERY_KEY,
} from '@/data/queries/user-scoped-query-keys';
import { requestHeaderPanel } from '@/data/use-open-header-panel';
import { AppToasts } from '@/features/notifications';
import { createFakeConnector, makeSite, TEST_USER, aiSettings } from '@/test/fake-connector';
import { renderWithProviders } from '@/test/render';
import pressableLogo from './pressable-logo.svg?raw';
import { PublishButton } from './publish-button';
import type { Snapshot } from '@/data/core';
import type { ConnectorOverrides } from '@/test/in-memory-connector';
const publishPanelName = /^(Choose a site|Preview details|Publish|Publish somewhere else)$/;

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
const sitesOf = ( provider: string ) =>
	( { wpcom: [ live ], spacefast: [ space ] } )[ provider ] ?? [];
const preview: Snapshot = {
	atomicSiteId: 123,
	localSiteId: site.id,
	userId: TEST_USER.id,
	date: Date.now(),
	url: 'lente-preview.wpcomstaging.com',
	shareUrl: 'https://lente-preview.wpcomstaging.com/?share=secret',
	launchUrl:
		'https://wordpress.com/setup/launch-site?siteId=123&checkout_source=studio-preview-site',
};
let sequence = 0;
beforeEach( () => {
	localStorage.clear();
	sessionStorage.removeItem( 'studio-publish-sign-in' );
	site.id = `provider-panel-${ ++sequence }`;
	live.localSiteId = site.id;
	space.localSiteId = site.id;
	preview.localSiteId = site.id;
} );
function setup( overrides: ConnectorOverrides = {}, notifications = false ) {
	const connector = createFakeConnector(
		{ sites: [ site ], user: TEST_USER },
		{
			getAiSettings: async () => aiSettings( 'wpcom', [ 'wpcom', 'spacefast' ] ),
			getPublishCheckoutUrl: buildPublishCheckoutUrl,
			getSnapshots: async () => [ preview ],
			getSnapshotUsage: async () => ( { siteCount: 1, siteLimit: 5, siteCreationBlocked: false } ),
			getRemoteSites: async ( provider ) => sitesOf( provider ),
			listAccountSites: async ( provider ) => sitesOf( provider ),
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
	return {
		...renderWithProviders(
			<>
				<PublishButton site={ site } />
				{ notifications && <AppToasts /> }
			</>,
			{ connector }
		),
		connector,
	};
}
async function openShare() {
	fireEvent.click( await screen.findByRole( 'button', { name: /^Publish…$/ } ) );
	const panel = await screen.findByRole( 'dialog', { name: publishPanelName } );
	await waitFor( () =>
		expect(
			within( panel ).queryByRole( 'status', { name: 'Loading destinations' } )
		).not.toBeInTheDocument()
	);
	return panel;
}
async function openFirstDestination() {
	const panel = await openShare();
	const first = panel.querySelector( '[data-slot="share-destinations"] [data-site]' );
	if ( first ) fireEvent.click( first );
	return panel;
}
async function openSiteActions( user: ReturnType< typeof setup >[ 'user' ] ) {
	await user.click( await screen.findByRole( 'button', { name: 'Site actions' } ) );
	return screen.findByRole( 'menu', { name: 'Site actions' } );
}

async function copyLink( user: ReturnType< typeof setup >[ 'user' ], panel?: HTMLElement ) {
	const scope = panel ? within( panel ) : screen;
	await user.click( scope.getByRole( 'button', { name: /^(Preview|Site) actions$/ } ) );
	await user.click( await screen.findByRole( 'menuitem', { name: 'Copy link' } ) );
	await waitFor( () => expect( screen.queryByRole( 'menu' ) ).not.toBeInTheDocument() );
}
async function confirmPublish() {
	const dialog = await screen.findByRole( 'alertdialog', { name: 'Publish changes?' } );
	const publish = within( dialog ).getByRole( 'button', { name: 'Publish changes' } );
	await waitFor( () => expect( publish ).toBeEnabled() );
	fireEvent.click( publish );
	await waitFor( () => expect( dialog ).not.toBeInTheDocument() );
}
async function openDestinations() {
	const back = screen.queryByRole( 'button', { name: 'Back' } );
	if ( back ) fireEvent.click( back );
	else if ( ! screen.queryByRole( 'dialog' ) ) return openShare();
	return screen.findByRole( 'dialog', { name: publishPanelName } );
}
function getDestinationRow( panel: HTMLElement, hostname: string ) {
	return within( panel ).getByRole( 'button', {
		name: ( _name, element ) =>
			element instanceof HTMLElement &&
			!! within( element ).queryByText( hostname, { exact: true } ),
	} );
}
async function switchTo( hostname: string ) {
	if (
		screen.queryByRole( 'link', { name: `Open ${ hostname }` } ) ||
		screen.queryByRole( 'link', { name: `Open preview: ${ hostname }` } )
	)
		return;
	const panel = await openDestinations();
	fireEvent.click( getDestinationRow( panel, hostname ) );
}

async function selectPreview( user: ReturnType< typeof setup >[ 'user' ], name: string ) {
	const selected = screen.queryByRole( 'group', { name: `Preview: ${ name }` } );
	if ( selected ) return selected;
	const list = await openDestinations();
	await user.click( within( list ).getByRole( 'button', { name } ) );
	return screen.findByRole( 'group', { name: `Preview: ${ name }` } );
}
async function openPreviewActions( user: ReturnType< typeof setup >[ 'user' ], name: string ) {
	await selectPreview( user, name );
	await user.click( screen.getByRole( 'button', { name: 'Preview actions' } ) );
	return screen.findByRole( 'menu', { name } );
}

async function openExistingSitePicker( user: ReturnType< typeof setup >[ 'user' ] ) {
	const elsewhere = screen.queryByRole( 'button', { name: 'Publish somewhere else' } );
	if ( elsewhere ) await user.click( elsewhere );
	await user.click( await screen.findByRole( 'combobox', { name: 'Destination' } ) );
	await user.click( await screen.findByRole( 'option', { name: 'Connect to an existing site' } ) );
	return screen.findByRole( 'dialog', { name: 'Choose an existing site' } );
}

it( 'checks only the selected destination in the background and refreshes the others when opened', async () => {
	vi.useFakeTimers( { shouldAdvanceTime: true } );
	const { connector, queryClient, unmount } = setup();
	try {
		await waitFor( () => {
			expect( queryClient.getQueryData( remoteSitesQueryKey( 'wpcom', site.id ) ) ).toEqual( [
				live,
			] );
			expect( queryClient.getQueryData( remoteSitesQueryKey( 'spacefast', site.id ) ) ).toEqual( [
				space,
			] );
			expect( queryClient.getQueryData( SNAPSHOTS_QUERY_KEY ) ).toEqual( [ preview ] );
			expect( connector.getSitePublishStatus ).toHaveBeenCalledWith( site.id, live.id, 'wpcom' );
		} );
		connector.getSitePublishStatus.mockClear();
		connector.getPreviewStatus.mockClear();
		await act( () => vi.advanceTimersByTimeAsync( 30_000 ) );
		expect( connector.getSitePublishStatus ).toHaveBeenCalledWith( site.id, live.id, 'wpcom' );
		expect( connector.getSitePublishStatus ).not.toHaveBeenCalledWith(
			site.id,
			space.id,
			'spacefast'
		);
		expect( connector.getPreviewStatus ).not.toHaveBeenCalled();

		const panel = await openShare();
		await waitFor( () => {
			expect( connector.getSitePublishStatus ).toHaveBeenCalledWith(
				site.id,
				space.id,
				'spacefast'
			);
			expect( connector.getPreviewStatus ).toHaveBeenCalledWith( preview.url );
		} );
		fireEvent.click( within( panel ).getByRole( 'button', { name: 'Preview 1' } ) );
		await screen.findByRole( 'group', { name: 'Preview: Preview 1' } );
		fireEvent.click( screen.getByRole( 'button', { name: 'Publish…' } ) );
		await waitFor( () => expect( panel ).not.toBeInTheDocument() );
		connector.getSitePublishStatus.mockClear();
		connector.getPreviewStatus.mockClear();
		await act( () => vi.advanceTimersByTimeAsync( 30_000 ) );
		expect( connector.getPreviewStatus ).toHaveBeenCalledWith( preview.url );
		expect( connector.getSitePublishStatus ).not.toHaveBeenCalled();
	} finally {
		unmount();
		vi.useRealTimers();
	}
} );

it( 'keeps the Publish indicator visible and marks the destinations with local changes', async () => {
	const second = {
		...preview,
		atomicSiteId: 456,
		date: preview.date + 1,
		url: 'second.wpcomstaging.com',
	};
	let changedHostname: string | undefined = second.url;
	const { queryClient, user } = setup( {
		getRemoteSites: async () => [],
		getSnapshots: async () => [ preview, second ],
		getPreviewStatus: async ( hostname ) => ( {
			localSiteId: site.id,
			localChanged: hostname === changedHostname,
			previewChanged: false,
		} ),
	} );
	await screen.findByRole( 'img', { name: 'Local changes' } );
	const panel = await openShare();
	const firstRow = within( panel ).getByRole( 'button', { name: 'Preview 1' } );
	const secondRow = within( panel ).getByRole( 'button', { name: 'Preview 2' } );
	const dot = '[data-slot="notification-dot"]';
	expect( screen.getByRole( 'img', { name: 'Local changes' } ) ).toBeVisible();
	expect( firstRow.querySelector( dot ) ).not.toBeInTheDocument();
	expect( secondRow.querySelector( dot ) ).toBeVisible();
	expect( secondRow ).toHaveAccessibleDescription( `${ second.url } · Local changes` );

	await user.click( firstRow );
	expect( screen.getByRole( 'img', { name: 'Local changes' } ) ).toBeVisible();
	await openDestinations();
	const firstRowAfterBack = within( panel ).getByRole( 'button', { name: 'Preview 1' } );
	const secondRowAfterBack = within( panel ).getByRole( 'button', { name: 'Preview 2' } );
	changedHostname = preview.url;
	await act( () => queryClient.invalidateQueries( { queryKey: [ 'preview-status' ] } ) );
	await waitFor( () => {
		expect( firstRowAfterBack.querySelector( dot ) ).toBeVisible();
		expect( secondRowAfterBack.querySelector( dot ) ).not.toBeInTheDocument();
	} );
	changedHostname = undefined;
	await act( () => queryClient.invalidateQueries( { queryKey: [ 'preview-status' ] } ) );
	await waitFor( () => {
		expect( firstRowAfterBack.querySelector( dot ) ).not.toBeInTheDocument();
		expect( screen.queryByRole( 'img', { name: 'Local changes' } ) ).not.toBeInTheDocument();
	} );
} );

it.each( [ 'previews', 'connections' ] )(
	'waits for delayed %s before choosing the entry view',
	async ( source ) => {
		let finish!: () => void;
		const ready = new Promise< void >( ( resolve ) => {
			finish = resolve;
		} );
		const { connector } = setup( {
			getSnapshots: async () => {
				if ( source === 'previews' ) await ready;
				return [ preview ];
			},
			getRemoteSites: async ( provider ) => {
				if ( source === 'connections' ) await ready;
				return provider === 'wpcom' ? [ live ] : [];
			},
		} );
		fireEvent.click( await screen.findByRole( 'button', { name: 'Publish…' } ) );
		expect( await screen.findByRole( 'status', { name: 'Loading destinations' } ) ).toBeVisible();
		expect( screen.queryByRole( 'button', { name: 'Create preview' } ) ).not.toBeInTheDocument();
		expect( screen.queryByRole( 'link', { name: 'Open lente.blog' } ) ).not.toBeInTheDocument();
		await act( async () => finish() );
		expect( await screen.findByRole( 'button', { name: live.name } ) ).toBeVisible();
		expect( screen.getByRole( 'button', { name: 'Preview 1' } ) ).toBeVisible();
		expect( connector.publishPreviewSite ).not.toHaveBeenCalled();
	}
);

it( 'shows known sites and retry feedback when previews fail, without navigating on retry', async () => {
	const { connector, user } = setup( {
		getSnapshots: async () => {
			throw new Error( 'Preview lookup failed' );
		},
		getRemoteSites: async ( provider ) => ( provider === 'wpcom' ? [ live ] : [] ),
	} );
	const panel = await openShare();
	expect( within( panel ).getByRole( 'button', { name: live.name } ) ).toBeEnabled();
	expect( within( panel ).getByRole( 'alert' ) ).toHaveTextContent(
		'Couldn’t load your previews.'
	);
	connector.getSnapshots.mockResolvedValue( [ preview ] );
	await user.click( within( panel ).getByRole( 'button', { name: 'Try again' } ) );
	expect( await within( panel ).findByRole( 'button', { name: 'Preview 1' } ) ).toBeVisible();
	expect( within( panel ).queryByRole( 'alert' ) ).not.toBeInTheDocument();
	expect( within( panel ).queryByRole( 'button', { name: 'Update…' } ) ).not.toBeInTheDocument();
} );

it.each( [ 'Back', 'Escape' ] )(
	'returns from creation to its chooser with %s and restores focus',
	async ( action ) => {
		const { user, connector } = setup();
		const panel = await openShare();
		await user.click( within( panel ).getByRole( 'button', { name: 'Publish somewhere else' } ) );
		await screen.findByRole( 'combobox', { name: 'Destination' } );
		if ( action === 'Back' ) await user.click( screen.getByRole( 'button', { name: 'Back' } ) );
		else await user.keyboard( '{Escape}' );
		await waitFor( () =>
			expect(
				within( panel ).getByRole( 'button', { name: 'Publish somewhere else' } )
			).toHaveFocus()
		);
		expect( within( panel ).getByRole( 'button', { name: live.name } ) ).toBeVisible();
		expect( connector.publishPreviewSite ).not.toHaveBeenCalled();
		expect( connector.createRemoteSite ).not.toHaveBeenCalled();
	}
);

it( 'keeps the current details during background refreshes and reevaluates on reopening', async () => {
	const { user, connector, queryClient } = setup( { getRemoteSites: async () => [] } );
	await openShare();
	expect( screen.getByRole( 'group', { name: 'Preview: Preview 1' } ) ).toBeVisible();
	connector.getRemoteSites.mockImplementation( async ( provider ) =>
		provider === 'wpcom' ? [ live ] : []
	);
	await act( () =>
		queryClient.invalidateQueries( { queryKey: remoteSitesQueryKey( 'wpcom', site.id ) } )
	);
	expect( screen.getByRole( 'group', { name: 'Preview: Preview 1' } ) ).toBeVisible();
	expect( screen.queryByRole( 'button', { name: live.name } ) ).not.toBeInTheDocument();
	await user.keyboard( '{Escape}' );
	await openShare();
	expect( screen.getByRole( 'button', { name: live.name } ) ).toBeVisible();
	expect( screen.getByRole( 'button', { name: 'Preview 1' } ) ).toBeVisible();
} );

it.each( [ 'removed', 'expired' ] )(
	'returns to available destinations when the selected preview is %s',
	async ( state ) => {
		const second = {
			...preview,
			atomicSiteId: 456,
			name: 'Other preview',
			url: 'other.wpcomstaging.com',
		};
		const { user, connector, queryClient } = setup( {
			getRemoteSites: async () => [],
			getSnapshots: async () => [ preview, second ],
		} );
		await openShare();
		await selectPreview( user, 'Preview 1' );
		connector.getSnapshots.mockResolvedValue(
			state === 'removed' ? [ second ] : [ { ...preview, expiresAt: Date.now() - 1000 }, second ]
		);
		await act( () => queryClient.invalidateQueries( { queryKey: SNAPSHOTS_QUERY_KEY } ) );
		expect( await screen.findByRole( 'button', { name: second.name } ) ).toBeVisible();
		expect( screen.queryByRole( 'button', { name: 'Update' } ) ).not.toBeInTheDocument();
		expect( screen.queryByRole( 'group', { name: /^Preview:/ } ) ).not.toBeInTheDocument();
		expect( connector.publishPreviewSite ).not.toHaveBeenCalled();
	}
);

it( 'follows an upgraded selected preview without duplicating it or selecting another site', async () => {
	const upgraded = { ...live, id: preview.atomicSiteId };
	const { user, connector, queryClient } = setup( { getRemoteSites: async () => [] } );
	await openShare();
	connector.getRemoteSites.mockImplementation( async ( provider ) =>
		provider === 'wpcom' ? [ upgraded ] : []
	);
	await act( () =>
		queryClient.invalidateQueries( { queryKey: remoteSitesQueryKey( 'wpcom', site.id ) } )
	);
	expect( await screen.findByRole( 'link', { name: 'Open lente.blog' } ) ).toBeVisible();
	expect( screen.queryByRole( 'group', { name: /^Preview:/ } ) ).not.toBeInTheDocument();
	await user.keyboard( '{Escape}' );
	await openShare();
	expect( screen.getByRole( 'link', { name: 'Open lente.blog' } ) ).toBeVisible();
	expect( screen.queryByRole( 'button', { name: 'Back' } ) ).not.toBeInTheDocument();
} );

it( 'does not label a new destination Live before its first publish', async () => {
	setup( {
		getRemoteSites: async ( provider ) =>
			provider === 'wpcom'
				? [
						{ ...live, lastPushTimestamp: null, launchAfterPush: true, launchStatus: 'unlaunched' },
				  ]
				: [],
		listAccountSites: async () => [],
	} );
	const panel = await openShare();
	expect(
		within( panel ).getByRole( 'button', { name: live.name } )
	).not.toHaveAccessibleDescription( expect.stringContaining( 'Live site' ) );
	expect( within( panel ).getByRole( 'button', { name: 'Preview 1' } ) ).toBeVisible();
} );

it( 'keeps status and Update bound to the viewed destination when the saved target changes', async () => {
	const { user, connector, queryClient } = setup();
	await openShare();
	await selectPreview( user, 'Preview 1' );
	await act( () =>
		queryClient.setQueryData( publishTargetQueryKey( site.id ), 'spacefast:site:spc_1' )
	);
	expect( screen.getByRole( 'group', { name: 'Preview: Preview 1' } ) ).toBeVisible();
	expect( screen.queryByText( 'Local changes', { exact: true } ) ).not.toBeInTheDocument();
	await user.click( await screen.findByRole( 'button', { name: 'Update' } ) );
	await waitFor( () =>
		expect( connector.publishPreviewSite ).toHaveBeenCalledExactlyOnceWith(
			site.id,
			preview.url,
			undefined
		)
	);
	expect( connector.pushSite ).not.toHaveBeenCalled();
} );

it( 'returns to available destinations after the viewed connection disappears', async () => {
	const { connector, queryClient } = setup( {
		getRemoteSites: async ( provider ) => ( provider === 'wpcom' ? [ live ] : [] ),
	} );
	await openFirstDestination();
	connector.getRemoteSites.mockResolvedValue( [] );
	await act( () =>
		queryClient.invalidateQueries( { queryKey: remoteSitesQueryKey( 'wpcom', site.id ) } )
	);
	expect( await screen.findByRole( 'button', { name: 'Preview 1' } ) ).toBeVisible();
	expect( screen.queryByRole( 'button', { name: 'Update' } ) ).not.toBeInTheDocument();
} );

it( 'discards an unfinished overwrite confirmation when returning to the chooser', async () => {
	const second = {
		...preview,
		atomicSiteId: 456,
		name: 'Other preview',
		url: 'other.wpcomstaging.com',
	};
	const { user, connector } = setup( {
		getRemoteSites: async () => [],
		listAccountSites: async () => [ { ...live, id: preview.atomicSiteId } ],
		getSnapshots: async () => [ preview, second ],
		getPreviewStatus: async ( hostname ) => ( {
			localSiteId: site.id,
			localChanged: true,
			previewChanged: hostname === preview.url,
		} ),
	} );
	await openShare();
	await selectPreview( user, 'Preview 1' );
	await user.click( screen.getByRole( 'button', { name: 'Update…' } ) );
	await screen.findByRole( 'heading', { name: 'Replace preview changes?' } );
	await user.keyboard( '{Escape}' );
	await screen.findByRole( 'dialog', { name: 'Preview details' } );
	await user.keyboard( '{Escape}' );
	expect( screen.getByRole( 'button', { name: 'Preview 1' } ) ).toHaveFocus();
	await selectPreview( user, second.name );
	expect(
		screen.queryByRole( 'heading', { name: 'Replace preview changes?' } )
	).not.toBeInTheDocument();
	await user.click( screen.getByRole( 'button', { name: 'Update' } ) );
	await waitFor( () =>
		expect( connector.publishPreviewSite ).toHaveBeenCalledExactlyOnceWith(
			site.id,
			second.url,
			undefined
		)
	);
} );

it( 'does not silently substitute a different destination for an unavailable explicit request', async () => {
	setup( {
		getSnapshots: async () => [],
		getRemoteSites: async ( provider ) => ( provider === 'wpcom' ? [ live ] : [] ),
	} );
	await screen.findByRole( 'button', { name: 'Publish…' } );
	act( () =>
		requestHeaderPanel( {
			panel: 'publish',
			siteId: site.id,
			provider: 'wpcom',
			remoteSiteId: 999,
			view: 'publish',
		} )
	);
	expect( await screen.findByRole( 'alert' ) ).toHaveTextContent(
		'The requested site is unavailable.'
	);
	expect( screen.getByRole( 'button', { name: live.name } ) ).toBeVisible();
	expect( screen.queryByRole( 'button', { name: 'Update…' } ) ).not.toBeInTheDocument();
} );

it( 'shares one in-flight preview comparison between the toolbar and Share panel', async () => {
	const { connector } = setup( {
		getRemoteSites: async () => [],
		getPreviewStatus: () => new Promise( () => {} ),
	} );
	await openFirstDestination();
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
	await openFirstDestination();
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
	expect( await screen.findByRole( 'button', { name: 'Publish somewhere else' } ) ).toBeVisible();
} );

it( 'renders the selected provider capabilities and retains another destination’s change dot', async () => {
	const { user, connector } = setup();
	await openFirstDestination();
	expect( await screen.findByRole( 'combobox', { name: 'Who can view' } ) ).toBeVisible();
	expect( screen.queryByRole( 'button', { name: 'What to publish' } ) ).not.toBeInTheDocument();
	expect( screen.queryByText( 'Some features may not work' ) ).not.toBeInTheDocument();
	expect( await screen.findByLabelText( 'Local changes' ) ).toBeVisible();
	const menu = await openSiteActions( user );
	expect(
		within( menu )
			.getAllByRole( 'menuitem' )
			.map( ( item ) => item.textContent?.trim() )
	).toEqual( [
		'Copy link',
		'Manage on WordPress.com',
		'Manage domains',
		'View backups',
		'Disconnect site…',
	] );
	await user.click( within( menu ).getByRole( 'menuitem', { name: 'Manage on WordPress.com' } ) );
	expect( connector.openExternalUrl ).toHaveBeenCalledExactlyOnceWith(
		'https://my.wordpress.com/sites/lente.blog'
	);
	connector.openExternalUrl.mockClear();
	await user.click( screen.getByRole( 'button', { name: 'Pull from live site…' } ) );
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
	await user.click( await screen.findByRole( 'button', { name: space.name } ) );
	expect( await screen.findByRole( 'link', { name: 'Open lente.space.fast' } ) ).toBeVisible();
	expect( screen.queryByRole( 'link', { name: 'Open lente.blog' } ) ).not.toBeInTheDocument();
	expect( screen.queryByText( 'Some features may not work' ) ).not.toBeInTheDocument();
	expect( screen.queryByText( 'Like forms, comments, and search' ) ).not.toBeInTheDocument();
	expect( screen.getByRole( 'combobox', { name: 'Who can view' } ) ).toBeVisible();
	expect( screen.queryByRole( 'button', { name: 'What to publish' } ) ).not.toBeInTheDocument();
	expect( screen.getByRole( 'button', { name: 'Update' } ) ).toBeVisible();
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
	).toEqual( [ 'Copy link', 'Manage on Spacefast', 'View versions', 'Disconnect site…' ] );
	await user.click(
		within( spacefastMenu ).getByRole( 'menuitem', { name: 'Manage on Spacefast' } )
	);
	expect( connector.openExternalUrl ).toHaveBeenCalledExactlyOnceWith(
		'https://my.spacefast.com/studio/lente'
	);
	await user.click(
		screen.getByRole( 'button', {
			name: 'Add a domain',
		} )
	);
	expect( connector.openExternalUrl ).toHaveBeenLastCalledWith(
		'https://my.spacefast.com/studio/lente/domains/add'
	);
} );

it( 'navigates between a connected site and its preview without starting an operation', async () => {
	const { connector, user } = setup( {
		getRemoteSites: async ( provider ) => ( provider === 'wpcom' ? [ live ] : [] ),
	} );
	const panel = await openShare();
	expect( within( panel ).getAllByText( 'lente.blog', { exact: true } ) ).toHaveLength( 1 );
	await user.click( within( panel ).getByRole( 'button', { name: live.name } ) );
	const menu = await openSiteActions( user );
	expect(
		within( menu ).queryByRole( 'menuitem', { name: 'Change destination…' } )
	).not.toBeInTheDocument();
	expect( within( menu ).queryByRole( 'menuitem', { name: 'Switch to' } ) ).not.toBeInTheDocument();
	await user.keyboard( '{Escape}' );
	await selectPreview( user, 'Preview 1' );
	expect(
		within( panel ).getByRole( 'link', { name: `Open preview: ${ preview.url }` } )
	).toBeVisible();
	await switchTo( 'lente.blog' );
	expect( within( panel ).getByRole( 'link', { name: 'Open lente.blog' } ) ).toBeVisible();
	expect( within( panel ).getByRole( 'button', { name: 'Back' } ) ).toHaveFocus();
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
	const panel = await openFirstDestination();
	expect( within( panel ).queryByRole( 'button', { name: 'Previews' } ) ).not.toBeInTheDocument();
	expect(
		within( panel ).queryByRole( 'button', { name: 'Choose destination' } )
	).not.toBeInTheDocument();
	expect( within( panel ).getByRole( 'link', { name: 'Open lente.space.fast' } ) ).toBeVisible();
	const menu = await openSiteActions( user );
	expect(
		within( menu )
			.getAllByRole( 'menuitem' )
			.map( ( item ) => item.textContent?.trim() )
	).toEqual( [ 'Copy link', 'Manage on Spacefast', 'View versions', 'Disconnect site…' ] );
	await user.click( within( menu ).getByRole( 'menuitem', { name: 'View versions' } ) );
	expect( connector.openExternalUrl ).toHaveBeenCalledExactlyOnceWith(
		'https://my.spacefast.com/studio/lente/versions'
	);
} );

it( 'opens a sole Spacefast destination from a Share request', async () => {
	const { history, connector } = setup( {
		getSnapshots: async () => [],
		getRemoteSites: async ( provider ) => ( provider === 'spacefast' ? [ space ] : [] ),
	} );
	act( () => requestHeaderPanel( { panel: 'share', siteId: site.id } ) );
	expect( await screen.findByRole( 'link', { name: 'Open lente.space.fast' } ) ).toBeVisible();
	expect( screen.getByRole( 'button', { name: 'Publish somewhere else' } ) ).toBeVisible();
	expect( history.location.search ).not.toContain( 'settings=sharing' );
	expect( connector.publishPreviewSite ).not.toHaveBeenCalled();
} );

it( 'opens View versions for a saved Spacefast connection without a team slug', async () => {
	const { connector, user } = setup( {
		getAiSettings: async () => aiSettings( 'wpcom', [ 'wpcom' ] ),
		getRemoteSites: async ( provider ) =>
			provider === 'spacefast' ? [ { ...space, teamSlug: undefined } ] : [],
	} );
	await openFirstDestination();
	const menu = await openSiteActions( user );
	await user.click( within( menu ).getByRole( 'menuitem', { name: 'View versions' } ) );
	expect( connector.openExternalUrl ).toHaveBeenCalledExactlyOnceWith(
		'https://my.spacefast.com/team/spc_1/versions'
	);
} );

it( 'opens the chooser for Share requests and honors explicit Publish destinations', async () => {
	setup();
	await screen.findByRole( 'button', { name: 'Publish…' } );
	act( () => requestHeaderPanel( { panel: 'share', siteId: site.id } ) );
	expect( await screen.findByRole( 'button', { name: live.name } ) ).toBeVisible();
	expect( screen.getByRole( 'button', { name: 'Preview 1' } ) ).toBeVisible();
	act( () =>
		requestHeaderPanel( {
			panel: 'publish',
			siteId: site.id,
			view: 'publish',
			provider: 'spacefast',
			remoteSiteId: space.id,
		} )
	);
	expect( await screen.findByRole( 'link', { name: 'Open lente.space.fast' } ) ).toBeVisible();
	expect( screen.queryByRole( 'button', { name: 'Preview 1' } ) ).not.toBeInTheDocument();
} );

it( 'reviews the destination and access before creating a new preview', async () => {
	const { user, connector } = setup( {
		publishPreviewSite: () => new Promise( () => {} ),
	} );
	await openFirstDestination();
	await openDestinations();
	await user.click( await screen.findByRole( 'button', { name: 'Publish somewhere else' } ) );
	const creation = await screen.findByRole( 'dialog', { name: 'Publish somewhere else' } );
	expect( within( creation ).getByRole( 'combobox', { name: 'Destination' } ) ).toHaveTextContent(
		'WordPress.com'
	);
	expect( within( creation ).getByRole( 'combobox', { name: 'Who can view' } ) ).toHaveTextContent(
		'Anyone with the link'
	);
	expect(
		within( creation ).queryByRole( 'button', { name: 'Launch on WordPress.com' } )
	).not.toBeInTheDocument();
	expect(
		within( creation ).queryByRole( 'button', { name: 'Previews' } )
	).not.toBeInTheDocument();
	expect( connector.publishPreviewSite ).not.toHaveBeenCalled();
	expect( connector.createRemoteSite ).not.toHaveBeenCalled();
	await user.click( within( creation ).getByRole( 'button', { name: 'Create preview' } ) );
	await waitFor( () =>
		expect( connector.publishPreviewSite ).toHaveBeenCalledExactlyOnceWith(
			site.id,
			undefined,
			undefined
		)
	);
} );

it.each( [ 'Back', 'Escape' ] )(
	'leaves new preview setup with %s without changing the current preview',
	async ( action ) => {
		const { user, connector } = setup( { getRemoteSites: async () => [] } );
		const panel = await openFirstDestination();
		await openDestinations();
		await user.click( screen.getByRole( 'button', { name: 'Publish somewhere else' } ) );
		const creation = await screen.findByRole( 'dialog', { name: 'Publish somewhere else' } );
		expect( within( creation ).getByRole( 'button', { name: 'Back' } ) ).toHaveFocus();
		await user.click( within( creation ).getByRole( 'combobox', { name: 'Destination' } ) );
		await user.click( await screen.findByRole( 'option', { name: 'Spacefast' } ) );
		await waitFor( () => expect( screen.queryByRole( 'listbox' ) ).not.toBeInTheDocument() );
		if ( action === 'Back' )
			await user.click( within( creation ).getByRole( 'button', { name: 'Back' } ) );
		else await user.keyboard( '{Escape}' );
		const previews = await screen.findByRole( 'dialog', { name: publishPanelName } );
		await waitFor( () =>
			expect(
				within( previews ).getByRole( 'button', { name: 'Publish somewhere else' } )
			).toHaveFocus()
		);
		expect(
			await within( panel ).findByRole( 'link', { name: `Open preview: ${ preview.url }` } )
		).toBeVisible();
		expect( connector.publishPreviewSite ).not.toHaveBeenCalled();
		expect( connector.createRemoteSite ).not.toHaveBeenCalled();
		expect( connector.disconnectRemoteSite ).not.toHaveBeenCalled();
	}
);

it( 'publishes a new Space in the team the user picks', async () => {
	let created = false;
	const { connector, user } = setup( {
		runSitesAction: async () => [
			{ id: 'agency', name: 'Agency' },
			{ id: 'mine', name: 'Mine' },
		],
		getSiteCreationVisibility: async ( _provider, input ) =>
			input?.team === 'mine' ? 'public' : 'private',
		getSnapshots: async () => [],
		getRemoteSites: async ( provider ) => ( provider === 'spacefast' && created ? [ space ] : [] ),
		createRemoteSite: async () => {
			created = true;
			return space;
		},
	} );
	await openFirstDestination();
	await user.click( screen.getByRole( 'combobox', { name: 'Destination' } ) );
	await user.click( await screen.findByRole( 'option', { name: 'Spacefast' } ) );
	const team = await screen.findByRole( 'combobox', { name: 'Team' } );
	expect( team ).toHaveAccessibleDescription( 'Agency' );
	await user.click( team );
	await user.click( await screen.findByRole( 'option', { name: 'Mine' } ) );
	expect( team ).toHaveAccessibleDescription( 'Mine' );
	const access = screen.getByRole( 'combobox', { name: 'Who can view' } );
	await user.click( access );
	await user.click( await screen.findByRole( 'option', { name: 'Everyone' } ) );
	await user.click( screen.getByRole( 'button', { name: 'Publish' } ) );
	await waitFor( () =>
		expect( connector.createRemoteSite ).toHaveBeenCalledExactlyOnceWith(
			'spacefast',
			site.id,
			{ name: site.name, visibility: 'public', input: { team: 'mine' } },
			false
		)
	);
} );

it( 'uses the destination and visibility chosen in new preview setup', async () => {
	let created = false;
	const { user, connector } = setup( {
		getSiteCreationVisibility: async () => 'public',
		getRemoteSites: async ( provider ) => ( provider === 'spacefast' && created ? [ space ] : [] ),
		createRemoteSite: async () => {
			created = true;
			return space;
		},
	} );
	await openFirstDestination();
	await openDestinations();
	await user.click( screen.getByRole( 'button', { name: 'Publish somewhere else' } ) );
	const creation = await screen.findByRole( 'dialog', { name: 'Publish somewhere else' } );
	await user.click( within( creation ).getByRole( 'combobox', { name: 'Destination' } ) );
	await user.click( await screen.findByRole( 'option', { name: 'Spacefast' } ) );
	const access = within( creation ).getByRole( 'combobox', { name: 'Who can view' } );
	await waitFor( () => expect( access ).toBeEnabled() );
	expect(
		within( creation ).queryByRole( 'button', { name: 'Add a domain' } )
	).not.toBeInTheDocument();
	await user.click( access );
	await user.click( await screen.findByRole( 'option', { name: 'Everyone' } ) );
	expect( connector.publishPreviewSite ).not.toHaveBeenCalled();
	expect( connector.createRemoteSite ).not.toHaveBeenCalled();
	await user.click( within( creation ).getByRole( 'button', { name: 'Publish' } ) );
	await waitFor( () =>
		expect( connector.createRemoteSite ).toHaveBeenCalledExactlyOnceWith(
			'spacefast',
			site.id,
			{ name: site.name, visibility: 'public', input: {} },
			false
		)
	);
	expect( await screen.findByRole( 'button', { name: space.name } ) ).toBeVisible();
	expect( connector.publishPreviewSite ).not.toHaveBeenCalled();
	const previews = await openDestinations();
	expect( within( previews ).getByRole( 'button', { name: /^Preview 1/ } ) ).toBeVisible();
} );

it( 'places Publish somewhere else below the details of a sole preview and restores focus on Back', async () => {
	const { user, connector } = setup( { getRemoteSites: async () => [] } );
	const panel = await openShare();
	expect( await within( panel ).findByRole( 'button', { name: 'Update' } ) ).toBeVisible();
	expect( within( panel ).queryByRole( 'button', { name: 'Previews' } ) ).not.toBeInTheDocument();
	expect( within( panel ).queryByRole( 'button', { name: 'Back' } ) ).not.toBeInTheDocument();
	const add = within( panel ).getByRole( 'button', { name: 'Publish somewhere else' } );
	expect( add ).toHaveTextContent( 'Publish somewhere else' );
	expect( add.parentElement?.lastElementChild ).toBe( add );
	expect( within( panel ).queryByText( 'New preview' ) ).not.toBeInTheDocument();
	expect(
		within( panel ).queryByRole( 'button', { name: 'Create preview' } )
	).not.toBeInTheDocument();
	const addressRow = within( panel ).getByRole( 'group', { name: 'Preview: Preview 1' } );
	expect( within( addressRow ).getByRole( 'link' ) ).toHaveAttribute( 'href', preview.shareUrl );
	await user.click( within( addressRow ).getByRole( 'button', { name: 'Preview actions' } ) );
	const menu = await screen.findByRole( 'menu' );
	expect(
		within( menu ).queryByRole( 'menuitem', { name: 'Connect to an existing site' } )
	).not.toBeInTheDocument();
	await user.keyboard( '{Escape}' );

	await user.click( add );
	expect( within( panel ).getByRole( 'button', { name: 'Create preview' } ) ).toBeEnabled();
	await openExistingSitePicker( user );
	await user.keyboard( '{Escape}' );
	expect( within( panel ).getByRole( 'combobox', { name: 'Destination' } ) ).toHaveFocus();
	await user.click( within( panel ).getByRole( 'button', { name: 'Back' } ) );
	expect( within( panel ).getByRole( 'button', { name: 'Publish somewhere else' } ) ).toHaveFocus();
	expect( connector.publishPreviewSite ).not.toHaveBeenCalled();
} );

it( 'opens the connected WordPress.com site domains without creating another site', async () => {
	const { user, connector } = setup( {
		getSnapshots: async () => [],
		getRemoteSites: async ( provider ) => ( provider === 'wpcom' ? [ live ] : [] ),
	} );
	const panel = await openFirstDestination();
	expect( within( panel ).getByRole( 'button', { name: 'Pull from live site…' } ) ).toBeVisible();
	const menu = await openSiteActions( user );
	const domain = within( menu ).getByRole( 'menuitem', { name: 'Manage domains' } );
	await user.click( domain );
	expect( connector.openExternalUrl ).toHaveBeenCalledExactlyOnceWith(
		'https://my.wordpress.com/sites/lente.blog/domains'
	);
	expect( connector.watchForPublishedSite ).not.toHaveBeenCalled();
	expect( connector.createRemoteSite ).not.toHaveBeenCalled();
	expect( connector.pushSite ).not.toHaveBeenCalled();
} );

it( 'offers information about Spacefast until a site exists', async () => {
	const { user, connector } = setup( {
		getSnapshots: async () => [],
		getRemoteSites: async () => [],
	} );
	const panel = await openFirstDestination();
	await user.click( within( panel ).getByRole( 'combobox', { name: 'Destination' } ) );
	await user.click( await screen.findByRole( 'option', { name: 'Spacefast' } ) );
	const learnMore = within( panel ).getByRole( 'button', { name: 'Learn about Spacefast' } );
	expect(
		within( panel ).queryByRole( 'button', { name: 'Launch on WordPress.com' } )
	).not.toBeInTheDocument();
	await user.click( learnMore );
	expect( connector.openExternalUrl ).toHaveBeenCalledExactlyOnceWith( 'https://spacefast.com' );
	expect( connector.createRemoteSite ).not.toHaveBeenCalled();
} );

it.each( [
	{ hostname: 'lente.blog', url: live.url },
	{ hostname: 'lente.space.fast', url: space.url },
] )( 'copies $hostname without a recorded publication', async ( { hostname, url } ) => {
	const wpcomSite = {
		...live,
		lastPushTimestamp: null,
		launchStatus: 'unlaunched' as const,
		visibility: 'private' as const,
	};
	const spacefastSite = { ...space, lastPushTimestamp: null };
	const { user, connector } = setup( {
		getRemoteSites: async ( provider ) =>
			provider === 'wpcom' ? [ wpcomSite ] : provider === 'spacefast' ? [ spacefastSite ] : [],
		listAccountSites: async ( provider ) =>
			provider === 'wpcom' ? [ wpcomSite ] : provider === 'spacefast' ? [ spacefastSite ] : [],
		getSiteVisibility: async ( provider ) => ( {
			url: provider === 'wpcom' ? wpcomSite.url : spacefastSite.url,
			visibility: 'private',
			launchStatus: 'unlaunched',
		} ),
	} );
	await openFirstDestination();
	await switchTo( hostname );
	const row = await screen.findByRole( 'link', { name: `Open ${ hostname }` } );
	expect( screen.queryByRole( 'heading', { name: 'Actions' } ) ).not.toBeInTheDocument();
	fireEvent.contextMenu( row );
	expect( screen.queryByRole( 'menu', { name: 'Site actions' } ) ).not.toBeInTheDocument();
	const trigger = screen.getByRole( 'button', { name: 'Site actions' } );
	trigger.focus();
	await user.keyboard( '{Enter}' );
	const menu = await screen.findByRole( 'menu', { name: 'Site actions' } );
	expect( within( menu ).getByRole( 'menuitem', { name: 'Copy link' } ) ).toBeVisible();
	await user.keyboard( '{Escape}' );
	await waitFor( () => expect( trigger ).toHaveFocus() );
	await copyLink( user );
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

	const panel = await openFirstDestination();
	expect( panel ).toHaveAccessibleName( 'Publish' );
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
	const reopened = await openFirstDestination();
	await user.click( within( reopened ).getByRole( 'button', { name: 'Publish' } ) );
	expect( await within( reopened ).findByRole( 'button', { name: 'Update' } ) ).toBeVisible();
	expect( reopened ).toHaveAccessibleName( 'Publish' );
	expect( notices() ).toHaveLength( 0 );
} );

it( 'reports a failed live push as a notification while keeping the panel open', async () => {
	setup( {
		pushSite: async () => {
			throw new Error( 'Upload failed' );
		},
	} );
	await openFirstDestination();
	await switchTo( 'lente.space.fast' );
	const publish = await screen.findByRole( 'button', { name: 'Update' } );
	await waitFor( () => expect( publish ).toBeEnabled() );
	fireEvent.click( publish );
	await waitFor(
		() =>
			expect( getVisibleToasts().filter( ( notice ) => notice.intent === 'error' ) ).toMatchObject(
				[ { title: 'Publishing didn’t finish' } ]
			),
		{ timeout: 3000 }
	);
	const panel = screen.getByRole( 'dialog', { name: publishPanelName } );
	expect( panel ).toBeVisible();
	expect( within( panel ).queryByRole( 'alert' ) ).not.toBeInTheDocument();
	expect( within( panel ).getByRole( 'button', { name: 'Update' } ) ).toBeEnabled();
} );
it( 'shows preview names in the chooser and only the domain in selected details', async () => {
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
	const panel = await openShare();
	expect( within( panel ).getByRole( 'button', { name: named.name } ) ).toHaveTextContent(
		named.url
	);
	expect( within( panel ).getByRole( 'button', { name: 'Preview 7' } ) ).toHaveTextContent(
		unnamed.url
	);
	const row = await selectPreview( user, 'Preview 7' );
	expect( row ).toHaveTextContent( unnamed.url );
	expect( within( row ).getByRole( 'link' ).textContent?.trim() ).toBe( unnamed.url );
	expect( screen.queryByRole( 'button', { name: 'Previews' } ) ).not.toBeInTheDocument();
	await user.click( screen.getByRole( 'link', { name: /^Open preview:/ } ) );
	expect( connector.openExternalUrl ).toHaveBeenCalledWith( unnamed.shareUrl );
	await copyLink( user, panel );
	expect( connector.copyText ).toHaveBeenCalledWith( unnamed.shareUrl );
} );

it( 'selects a preview by keyboard and restores its row on Back and Escape', async () => {
	const second = {
		...preview,
		atomicSiteId: 456,
		name: 'Client review',
		url: 'second-preview.wpcomstaging.com',
		shareUrl: 'https://second-preview.wpcomstaging.com/?share=second',
	};
	const { user, connector } = setup( { getSnapshots: async () => [ preview, second ] } );
	const panel = await openShare();
	const row = within( panel ).getByRole( 'button', { name: second.name } );
	expect(
		within( panel ).queryByRole( 'combobox', { name: 'Who can view' } )
	).not.toBeInTheDocument();
	row.focus();
	await user.keyboard( '{Enter}' );
	const selected = await within( panel ).findByRole( 'group', { name: 'Preview: Client review' } );
	expect( selected ).toHaveTextContent( second.url );
	expect( within( selected ).queryByText( second.name ) ).not.toBeInTheDocument();
	expect( within( panel ).getByRole( 'button', { name: 'Back' } ) ).toHaveFocus();
	await user.keyboard( '{Escape}' );
	expect( within( panel ).getByRole( 'button', { name: second.name } ) ).toHaveFocus();
	await user.keyboard( '{Enter}' );
	await copyLink( user, panel );
	expect( connector.copyText ).toHaveBeenCalledExactlyOnceWith( second.shareUrl );
	await user.click( screen.getByRole( 'button', { name: 'Back' } ) );
	expect( screen.getByRole( 'button', { name: second.name } ) ).toHaveFocus();
	await user.keyboard( '{Escape}' );
	await waitFor( () => expect( panel ).not.toBeInTheDocument() );
	expect( screen.getByRole( 'button', { name: 'Publish…' } ) ).toHaveFocus();
	await openShare();
	expect( screen.getByRole( 'button', { name: second.name } ) ).toBeVisible();
	expect(
		screen.queryByRole( 'group', { name: 'Preview: Client review' } )
	).not.toBeInTheDocument();
	expect( connector.publishPreviewSite ).not.toHaveBeenCalled();
} );

it( 'omits rename and keeps deletion scoped to the selected preview', async () => {
	const second = {
		...preview,
		atomicSiteId: 456,
		name: 'Homepage refresh',
		url: 'homepage-preview.wpcomstaging.com',
	};
	const { user, connector } = setup( {
		getSnapshots: async () => [ preview, second ],
	} );
	await openFirstDestination();
	const actions = await openPreviewActions( user, second.name );
	expect( within( actions ).queryByRole( 'menuitem', { name: 'Rename' } ) ).not.toBeInTheDocument();
	await user.click( within( actions ).getByRole( 'menuitem', { name: 'Delete preview…' } ) );
	const confirmation = await screen.findByRole( 'alertdialog', { name: 'Delete preview?' } );
	expect( within( confirmation ).getByText( second.name ) ).toBeVisible();
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
	const panel = await openFirstDestination();
	const menu = await openDestinations();
	await user.click( within( menu ).getByRole( 'button', { name: 'Publish somewhere else' } ) );
	await user.click( await screen.findByRole( 'button', { name: 'Create preview' } ) );
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

it.each( [
	{ host: 'Pressable', isPressable: true, logo: pressableLogo },
	{ host: 'WordPress.com', isPressable: false, logo: getProvider( 'wpcom' ).logo! },
] )( 'keeps the $host logo in the destination chooser', async ( { isPressable, logo } ) => {
	const remote = { ...live, isPressable };
	setup( {
		getSnapshots: async () => [],
		getRemoteSites: async ( provider ) =>
			provider === 'wpcom' ? [ remote ] : sitesOf( provider ),
		listAccountSites: async ( provider ) =>
			provider === 'wpcom' ? [ remote ] : sitesOf( provider ),
	} );
	const hostname = new URL( remote.url ).hostname;
	const panel = await openFirstDestination();
	const openSite = await within( panel ).findByRole( 'link', { name: `Open ${ hostname }` } );
	expect( openSite ).not.toContainHTML( logo );

	const picker = await openDestinations();
	expect( within( picker ).getByRole( 'button', { name: remote.name } ) ).toContainHTML( logo );
} );

it( 'lists connected destinations above previews and marks only published sites Live', async () => {
	const { connector, user } = setup( {
		getRemoteSites: async ( provider ) =>
			provider === 'wpcom'
				? [ live ]
				: provider === 'spacefast'
				? [ { ...space, lastPushTimestamp: null } ]
				: [],
		listAccountSites: async ( provider ) => ( provider === 'wpcom' ? [ live ] : [] ),
	} );
	const panel = await openShare();
	const rows = within(
		panel.querySelector( '[data-slot="share-destinations"]' ) as HTMLElement
	).getAllByRole( 'button' );
	expect( rows.map( ( row ) => row.getAttribute( 'aria-label' ) ?? row.textContent ) ).toEqual( [
		live.name,
		space.name,
		'Preview 1',
		'Publish somewhere else',
		'Connect to an existing site',
	] );
	expect( rows[ 0 ] ).toHaveAccessibleDescription( 'lente.blog · Live site' );
	expect( within( rows[ 0 ] ).getByText( 'lente.blog', { exact: true } ) ).toBeVisible();
	expect( within( rows[ 1 ] ).getByText( 'lente.space.fast', { exact: true } ) ).toBeVisible();
	expect( within( rows[ 2 ] ).getByText( preview.url, { exact: true } ) ).toBeVisible();
	expect( rows[ 1 ] ).not.toHaveTextContent( 'Live' );
	expect( rows[ 2 ] ).not.toHaveTextContent( 'Live' );
	expect( within( panel ).getByRole( 'separator' ) ).toBeVisible();
	expect(
		within( panel ).queryByRole( 'button', { name: 'Launch on WordPress.com' } )
	).not.toBeInTheDocument();
	expect(
		within( panel ).queryByRole( 'combobox', { name: 'Who can view' } )
	).not.toBeInTheDocument();
	await user.click( rows[ 1 ] );
	const addressRow = within( panel ).getByRole( 'group', { name: space.name } );
	const siteLink = within( addressRow ).getByRole( 'link', { name: 'Open lente.space.fast' } );
	expect( within( addressRow ).getByRole( 'button', { name: 'Site actions' } ) ).toBeVisible();
	expect( within( siteLink ).queryByText( space.name, { exact: true } ) ).not.toBeInTheDocument();
	expect( within( siteLink ).getByText( 'lente.space.fast', { exact: true } ) ).toBeVisible();
	expect( within( panel ).getByRole( 'button', { name: 'Update' } ) ).toBeVisible();
	expect( within( panel ).queryByRole( 'button', { name: 'Previews' } ) ).not.toBeInTheDocument();
	expect( connector.createRemoteSite ).not.toHaveBeenCalled();
	expect( connector.pushSite ).not.toHaveBeenCalled();
	expect( connector.publishPreviewSite ).not.toHaveBeenCalled();
} );

it( 'selects between two Spacefast sites by keyboard and updates the exact destination', async () => {
	const second = { ...space, id: 'spc_2', slug: 'second', url: 'https://second.space.fast' };
	const { connector, user } = setup( {
		getSnapshots: async () => [],
		getRemoteSites: async ( provider ) => ( provider === 'spacefast' ? [ space, second ] : [] ),
		getSitePublishStatus: async () => ( { localChanged: false } ),
	} );
	const panel = await openShare();
	expect( within( panel ).getAllByRole( 'button', { name: space.name } ) ).toHaveLength( 2 );
	expect( getDestinationRow( panel, 'lente.space.fast' ) ).toHaveFocus();
	await user.tab();
	expect( getDestinationRow( panel, 'second.space.fast' ) ).toHaveFocus();
	await user.keyboard( '{Enter}' );
	expect( within( panel ).getByRole( 'link', { name: 'Open second.space.fast' } ) ).toBeVisible();
	await copyLink( user, panel );
	expect( connector.copyText ).toHaveBeenCalledExactlyOnceWith( second.url );
	await user.click( await screen.findByRole( 'button', { name: 'Update' } ) );
	await waitFor( () =>
		expect( connector.pushSite ).toHaveBeenCalledExactlyOnceWith(
			'spacefast',
			site.id,
			second.id,
			undefined
		)
	);
	expect( within( panel ).getByRole( 'link', { name: 'Open second.space.fast' } ) ).toBeVisible();
	await waitFor( () =>
		expect( within( panel ).getByRole( 'button', { name: 'Back' } ) ).toBeEnabled()
	);
	await user.click( within( panel ).getByRole( 'button', { name: 'Back' } ) );
	expect( getDestinationRow( panel, 'second.space.fast' ) ).toHaveFocus();
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
		await openFirstDestination();
		expect( screen.queryByText( 'Make it with Spacefast' ) ).not.toBeInTheDocument();
		await waitFor( () =>
			expect(
				screen.getByRole( 'combobox', { name: 'Who can view' } )
			).toHaveAccessibleDescription( 'Restricted' )
		);
		expect( screen.queryByText( 'A static copy of your pages.' ) ).not.toBeInTheDocument();
		expect( screen.getByRole( 'button', { name: 'Publish' } ) ).toBeVisible();
		const destination = screen.getByRole( 'combobox', { name: 'Destination' } );
		destination.focus();
		await user.keyboard( '{ArrowDown}' );
		const picker = await screen.findByRole( 'listbox' );
		expect( within( picker ).getAllByRole( 'option' )[ 0 ] ).toHaveTextContent( 'WordPress.com' );
		expect( within( picker ).getByRole( 'option', { name: 'Spacefast' } ) ).toBeVisible();
	}
);

it( 'shows preview access for WordPress.com', async () => {
	const { connector, user } = setup( {
		getRemoteSites: async () => [],
		getSnapshots: async () => [],
		getPreviewStatus: async () => ( {
			localSiteId: site.id,
			localChanged: false,
			previewChanged: false,
		} ),
	} );
	await openFirstDestination();
	expect( screen.getByText( 'Destination' ) ).toBeVisible();
	expect( screen.getByRole( 'combobox', { name: 'Destination' } ) ).toBeVisible();
	expect( screen.getByRole( 'combobox', { name: 'Who can view' } ) ).toHaveAccessibleDescription(
		'Anyone with the link'
	);
	expect( screen.getByRole( 'button', { name: 'Create preview' } ) ).toBeVisible();
	expect( connector.publishPreviewSite ).not.toHaveBeenCalled();
	await user.click( screen.getByRole( 'combobox', { name: 'Destination' } ) );
	expect( await screen.findByRole( 'option', { name: 'WordPress.com' } ) ).toBeVisible();
	expect( screen.getByRole( 'option', { name: 'Spacefast' } ) ).toBeVisible();
	expect( screen.getByRole( 'option', { name: 'Connect to an existing site' } ) ).toBeVisible();
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
		await openFirstDestination();
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
				{ name: site.name, visibility: expected, input: {} },
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
			await screen.findByRole( 'button', { name: 'Publish…' }, { timeout: 4000 } )
		).toBeVisible();
		expect( localStorage.getItem( 'studio-last-publish-provider' ) ).toBe( 'spacefast' );
	}
);

it( 'opens the selected preview from its URL without copying the link', async () => {
	const { user, connector } = setup();
	await openFirstDestination();
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
				provider === 'wpcom'
					? state === 'selected'
						? [ live ]
						: []
					: removed
					? []
					: sitesOf( provider ),
			getSnapshots: async () => ( state === 'with preview' ? [ preview ] : [] ),
			disconnectRemoteSite: async () => {
				removed = true;
			},
		} );
		await openFirstDestination();
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

		await openFirstDestination();
		await switchTo( 'lente.space.fast' );
		const confirmation = await showConfirmation();
		await user.click( within( confirmation ).getByRole( 'button', { name: 'Disconnect site' } ) );
		await waitFor( () => expect( confirmation ).not.toBeInTheDocument() );
		expect( connector.disconnectRemoteSite ).toHaveBeenCalledExactlyOnceWith(
			'spacefast',
			site.id,
			space.id
		);
		expect( connector.deleteSnapshot ).not.toHaveBeenCalled();

		const panel = await screen.findByRole( 'dialog', { name: publishPanelName } );
		expect(
			within( panel ).queryByRole( 'link', { name: 'Open lente.space.fast' } )
		).not.toBeInTheDocument();
		if ( state === 'only' ) {
			expect( within( panel ).getByRole( 'combobox', { name: 'Destination' } ) ).toBeVisible();
			expect(
				within( panel ).queryByRole( 'button', { name: 'Connect to an existing site' } )
			).not.toBeInTheDocument();
		} else if ( state === 'selected' ) {
			expect( await screen.findByRole( 'link', { name: 'Open lente.blog' } ) ).toBeVisible();
		}
		if ( state === 'with preview' ) {
			expect( await selectPreview( user, 'Preview 1' ) ).toHaveTextContent( preview.url );
		}
	}
);

it( 'restores the default for an unavailable destination and switches providers', async () => {
	localStorage.setItem( 'studio-last-publish-provider', 'unknown-provider' );
	const { connector, user } = setup( {
		getRemoteSites: async () => [],
		getSnapshots: async () => [],
	} );
	await openFirstDestination();
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

it( 'shows WordPress.com publishing controls before connecting and returns after sign-in', async () => {
	let signedIn = false;
	const { connector, history, user } = setup( {
		getAuthUser: async () => ( signedIn ? TEST_USER : null ),
		getAiSettings: async () => aiSettings( 'wpcom', signedIn ? [ 'wpcom' ] : [] ),
		getRemoteSites: async () => [],
		getSnapshots: async () => [],
	} );
	const panel = await openShare();
	const destination = within( panel ).getByRole( 'combobox', { name: 'Destination' } );
	expect( destination ).toHaveAccessibleDescription( 'WordPress.com' );
	expect(
		within( panel ).getByRole( 'combobox', { name: 'Who can view' } )
	).toHaveAccessibleDescription( 'Anyone with the link' );
	expect(
		within( panel ).getByRole( 'button', { name: 'Launch on WordPress.com' } )
	).toBeVisible();
	expect( connector.authenticate ).not.toHaveBeenCalled();
	await user.click( destination );
	expect(
		await screen.findByRole( 'option', { name: 'WordPress.com' } )
	).toHaveAccessibleDescription( 'The full WordPress, with a domain.' );
	expect( screen.getByRole( 'option', { name: 'Spacefast' } ) ).toHaveAccessibleDescription(
		'A static copy of your pages.'
	);
	expect( screen.getByRole( 'option', { name: 'Spacefast' } ) ).toHaveAttribute(
		'aria-selected',
		'false'
	);
	await user.keyboard( '{Escape}' );
	await user.click( within( panel ).getByRole( 'button', { name: 'Connect to share previews' } ) );
	await waitFor( () => expect( connector.authenticate ).toHaveBeenCalledOnce() );
	expect( history.location.search ).not.toContain( 'settings=providers' );
	expect( destination ).toHaveAccessibleDescription( 'WordPress.com' );
	await user.click( within( panel ).getByRole( 'combobox', { name: 'Who can view' } ) );
	await user.click( await screen.findByRole( 'option', { name: 'Everyone' } ) );
	await act( async () => {
		signedIn = true;
		connector.emit( 'onAuthStateChanged' );
	} );
	await waitFor( () => expect( destination ).toHaveAccessibleDescription( 'WordPress.com' ) );
	expect(
		await within( panel ).findByRole( 'button', { name: 'Continue on WordPress.com' } )
	).toBeVisible();
	await user.click( within( panel ).getByRole( 'combobox', { name: 'Who can view' } ) );
	await user.click( await screen.findByRole( 'option', { name: 'Anyone with the link' } ) );
	expect( within( panel ).getByRole( 'button', { name: 'Create preview' } ) ).toBeVisible();
	expect( connector.publishPreviewSite ).not.toHaveBeenCalled();
	expect( connector.createRemoteSite ).not.toHaveBeenCalled();
	expect( connector.pushSite ).not.toHaveBeenCalled();
} );

it.each( [ false, true ] )(
	'connects a provider before choosing an existing site with a sign-in redirect: %s',
	async ( redirect ) => {
		let signedIn = false;
		let connected = false;
		const first = setup( {
			getAuthUser: async () => ( signedIn ? TEST_USER : null ),
			getAiSettings: async () => aiSettings( 'wpcom', signedIn ? [ 'wpcom' ] : [] ),
			getRemoteSites: async ( provider ) => ( provider === 'wpcom' && connected ? [ live ] : [] ),
			listAccountSites: async ( provider ) => ( provider === 'wpcom' ? [ live ] : [] ),
			getSnapshots: async () => [],
			connectRemoteSite: async () => {
				connected = true;
			},
			...( redirect ? { authenticate: async () => new Promise< void >( () => {} ) } : {} ),
		} );
		await openShare();
		await openExistingSitePicker( first.user );
		const step = await screen.findByRole( 'dialog', { name: 'Choose an existing site' } );
		expect(
			within( step ).getByText( 'Connect a provider to see your existing sites.' )
		).toBeVisible();
		expect( within( step ).queryByText( 'No existing sites.' ) ).not.toBeInTheDocument();
		expect( within( step ).getByRole( 'button', { name: 'Connect to Spacefast' } ) ).toBeVisible();
		await first.user.click(
			within( step ).getByRole( 'button', { name: 'Connect to WordPress.com' } )
		);
		await waitFor( () => expect( first.connector.authenticate ).toHaveBeenCalledOnce() );
		if ( ! redirect ) {
			await act( async () => {
				signedIn = true;
				first.connector.emit( 'onAuthStateChanged' );
			} );
		} else {
			const handoff = sessionStorage.getItem( 'studio-publish-sign-in' );
			expect( handoff ).not.toBeNull();
			first.unmount();
			sessionStorage.setItem( 'studio-publish-sign-in', handoff! );
			signedIn = true;
			renderWithProviders( <PublishButton site={ site } />, {
				connector: first.connector,
				queryClient: first.queryClient,
			} );
		}
		const chooser = within(
			await screen.findByRole( 'dialog', { name: 'Choose an existing site' } )
		);
		await first.user.click( await chooser.findByRole( 'button', { name: /Live.*lente.blog/ } ) );
		expect( await screen.findByRole( 'link', { name: 'Open lente.blog' } ) ).toBeVisible();
		expect( first.connector.connectRemoteSite ).toHaveBeenCalledExactlyOnceWith(
			'wpcom',
			site.id,
			live
		);
		expect( first.connector.pushSite ).not.toHaveBeenCalled();
		expect( first.connector.pullSite ).not.toHaveBeenCalled();
	}
);

it( 'restores the access choice after sign-in redirects back to Publish', async () => {
	let signedIn = false;
	const overrides: ConnectorOverrides = {
		getAuthUser: async () => ( signedIn ? TEST_USER : null ),
		getAiSettings: async () => aiSettings( 'wpcom', signedIn ? [ 'wpcom' ] : [] ),
		getRemoteSites: async () => [],
		getSnapshots: async () => [],
		authenticate: async () => new Promise< void >( () => {} ),
	};
	const first = setup( overrides );
	await openShare();
	await first.user.click( screen.getByRole( 'combobox', { name: 'Who can view' } ) );
	await first.user.click( await screen.findByRole( 'option', { name: 'Everyone' } ) );
	await first.user.click( screen.getByRole( 'button', { name: 'Connect to publish' } ) );
	const handoff = sessionStorage.getItem( 'studio-publish-sign-in' );
	expect( handoff ).not.toBeNull();
	first.unmount();
	// A full-page redirect preserves session storage without unmounting the app.
	sessionStorage.setItem( 'studio-publish-sign-in', handoff! );
	signedIn = true;
	renderWithProviders( <PublishButton site={ site } />, {
		connector: first.connector,
		queryClient: first.queryClient,
	} );
	const panel = await screen.findByRole( 'dialog', { name: 'Publish' } );
	expect( await within( panel ).findByText( 'WordPress.com' ) ).toBeVisible();
	expect(
		await within( panel ).findByRole( 'combobox', { name: 'Who can view' } )
	).toHaveAccessibleDescription( 'Everyone' );
	expect(
		within( panel ).getByRole( 'button', { name: 'Continue on WordPress.com' } )
	).toBeVisible();
	expect( first.connector.publishPreviewSite ).not.toHaveBeenCalled();
	expect( first.connector.openExternalUrl ).not.toHaveBeenCalled();
} );

it( 'does not reopen Publish when a pending sign-in was dismissed', async () => {
	let signedIn = false;
	const { connector, user } = setup( {
		getAuthUser: async () => ( signedIn ? TEST_USER : null ),
		getAiSettings: async () => aiSettings( 'wpcom', signedIn ? [ 'wpcom' ] : [] ),
		getRemoteSites: async () => [],
		getSnapshots: async () => [],
	} );
	await openShare();
	await user.click( screen.getByRole( 'button', { name: 'Connect to share previews' } ) );
	await waitFor( () => expect( connector.authenticate ).toHaveBeenCalledOnce() );
	await user.keyboard( '{Escape}' );
	await waitFor( () => expect( screen.queryByRole( 'dialog' ) ).not.toBeInTheDocument() );
	await act( async () => {
		signedIn = true;
		connector.emit( 'onAuthStateChanged' );
	} );
	await waitFor( () => expect( connector.getAuthUser ).toHaveResolvedWith( TEST_USER ) );
	expect( screen.queryByRole( 'dialog' ) ).not.toBeInTheDocument();
	expect( connector.publishPreviewSite ).not.toHaveBeenCalled();
} );

it( 'reconnects a remembered destination without publishing it', async () => {
	let signedIn = false;
	const { connector, user } = setup( {
		getAuthUser: async () => ( signedIn ? TEST_USER : null ),
		getAiSettings: async () => aiSettings( 'wpcom', signedIn ? [ 'wpcom' ] : [] ),
		getRemoteSites: async ( provider ) => ( provider === 'wpcom' ? [ live ] : [] ),
		getSnapshots: async () => [],
	} );
	await openShare();
	expect( await screen.findByRole( 'link', { name: 'Open lente.blog' } ) ).toBeVisible();
	expect( connector.getSiteVisibility ).not.toHaveBeenCalled();
	expect( connector.getSitePublishStatus ).not.toHaveBeenCalled();
	await user.click( screen.getByRole( 'button', { name: 'Connect to WordPress.com' } ) );
	await waitFor( () => expect( connector.authenticate ).toHaveBeenCalledOnce() );
	await act( async () => {
		signedIn = true;
		connector.emit( 'onAuthStateChanged' );
	} );
	await waitFor( () =>
		expect(
			screen.queryByRole( 'button', { name: 'Connect to WordPress.com' } )
		).not.toBeInTheDocument()
	);
	expect( screen.getByRole( 'link', { name: 'Open lente.blog' } ) ).toBeVisible();
	expect( connector.disconnectRemoteSite ).not.toHaveBeenCalled();
	expect( connector.pushSite ).not.toHaveBeenCalled();
	expect( connector.pullSite ).not.toHaveBeenCalled();
} );

it( 'offers WordPress.com directly when Spacefast is the only connected destination', async () => {
	localStorage.setItem( 'studio-last-publish-provider', 'wpcom' );
	const { connector, history, user } = setup( {
		getAuthUser: async () => null,
		getAiSettings: async () => aiSettings( 'wpcom', [ 'spacefast' ] ),
		getRemoteSites: async () => [],
		getSnapshots: async () => [],
	} );
	await openFirstDestination();
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
	await user.click( screen.getByRole( 'option', { name: 'WordPress.com' } ) );
	expect( connector.authenticate ).not.toHaveBeenCalled();
	await user.click( screen.getByRole( 'button', { name: 'Connect to share previews' } ) );
	await waitFor( () =>
		expect( connector.authenticate ).toHaveBeenCalledWith(
			true,
			'previews_tab',
			expect.objectContaining( { placement: 'share', intent: 'share' } )
		)
	);
	expect( history.location.search ).not.toContain( 'settings=providers' );
} );

it( 'connects Spacefast from the destination picker and returns to publishing', async () => {
	const signIn = {
		url: 'https://auth.example.test/spacefast',
		code: 'ABCD-EFGH',
		handoff: { deviceCode: 'device-1' },
	};
	const { connector, user } = setup( {
		getAuthUser: async () => null,
		getAiSettings: async () => aiSettings( 'wpcom', [] ),
		getRemoteSites: async () => [],
		getSnapshots: async () => [],
	} );
	connector.startProviderConnect.mockResolvedValue( signIn );
	let approve!: () => void;
	connector.connectProvider.mockReturnValue(
		new Promise( ( resolve ) => {
			approve = () => {
				const settings = aiSettings( 'wpcom', [ 'spacefast' ] );
				connector.getAiSettings.mockResolvedValue( settings );
				resolve( settings );
			};
		} )
	);
	const panel = await openFirstDestination();
	await user.click( within( panel ).getByRole( 'combobox', { name: 'Destination' } ) );
	expect( screen.queryByRole( 'option', { name: 'Add more providers' } ) ).not.toBeInTheDocument();
	await user.click( await screen.findByRole( 'option', { name: 'Spacefast' } ) );
	expect( connector.startProviderConnect ).not.toHaveBeenCalled();
	expect(
		within( panel ).getByRole( 'combobox', { name: 'Who can view' } )
	).toHaveAccessibleDescription( 'Restricted' );
	expect( within( panel ).getByRole( 'combobox', { name: 'Who can view' } ) ).toBeDisabled();
	await user.click(
		await within( panel ).findByRole( 'button', { name: 'Connect to Spacefast' } )
	);
	let dialog = await screen.findByRole( 'dialog', { name: 'Connect to Spacefast' } );
	expect( await within( dialog ).findByText( signIn.code ) ).toBeVisible();
	expect(
		within( dialog ).getByText(
			'Make sure the codes match in your browser, then approve the connection.'
		)
	).toBeVisible();
	expect( screen.queryByRole( 'dialog', { name: 'Publish' } ) ).not.toBeInTheDocument();
	await waitFor( () =>
		expect( connector.openExternalUrl ).toHaveBeenCalledExactlyOnceWith( signIn.url )
	);
	expect( await within( dialog ).findByText( 'Waiting for approval…' ) ).toBeVisible();

	await user.click( within( dialog ).getByRole( 'button', { name: 'Close' } ) );
	const destination = await screen.findByRole( 'combobox', { name: 'Destination' } );
	await waitFor( () => expect( destination ).toHaveFocus() );
	expect( destination ).toHaveAccessibleDescription( 'Spacefast' );
	await user.click( screen.getByRole( 'button', { name: 'Connect to Spacefast' } ) );
	dialog = await screen.findByRole( 'dialog', { name: 'Connect to Spacefast' } );
	expect( await within( dialog ).findByText( signIn.code ) ).toBeVisible();
	await waitFor( () => expect( connector.openExternalUrl ).toHaveBeenCalledTimes( 2 ) );
	await user.click( within( dialog ).getByRole( 'button', { name: 'Open Spacefast' } ) );
	expect( connector.openExternalUrl ).toHaveBeenCalledTimes( 3 );
	expect( connector.startProviderConnect ).toHaveBeenCalledTimes( 1 );
	await act( async () => approve() );
	const selected = await screen.findByRole( 'combobox', { name: 'Destination' } );
	await waitFor( () => expect( selected ).toHaveAccessibleDescription( 'Spacefast' ) );
	expect( await screen.findByRole( 'button', { name: 'Publish' } ) ).toBeVisible();
	expect( connector.createRemoteSite ).not.toHaveBeenCalled();
	expect( connector.pushSite ).not.toHaveBeenCalled();
} );

it( 'returns to existing sites after connecting Spacefast', async () => {
	// On a slow machine the next frame can come before the popover content mounts.
	const frame = vi.spyOn( window, 'requestAnimationFrame' ).mockImplementation( ( callback ) => {
		queueMicrotask( () => callback( performance.now() ) );
		return 0;
	} );
	onTestFinished( () => frame.mockRestore() );
	const { connector, user } = setup( {
		getAuthUser: async () => null,
		getAiSettings: async () => aiSettings( 'wpcom', [] ),
		getRemoteSites: async () => [],
		getSnapshots: async () => [],
	} );
	connector.startProviderConnect.mockResolvedValue( {
		url: 'https://auth.example.test/spacefast',
		code: 'ABCD-EFGH',
		handoff: { deviceCode: 'device-1' },
	} );
	let approve!: () => void;
	connector.connectProvider.mockReturnValue(
		new Promise( ( resolve ) => {
			approve = () => {
				const settings = aiSettings( 'wpcom', [ 'spacefast' ] );
				connector.getAiSettings.mockResolvedValue( settings );
				resolve( settings );
			};
		} )
	);
	await openShare();
	await openExistingSitePicker( user );
	await user.click( screen.getByRole( 'button', { name: 'Connect to Spacefast' } ) );
	const signIn = await screen.findByRole( 'dialog', { name: 'Connect to Spacefast' } );
	expect( await within( signIn ).findByText( 'ABCD-EFGH' ) ).toBeVisible();
	await act( async () => approve() );
	const step = await screen.findByRole( 'dialog', { name: 'Choose an existing site' } );
	expect(
		await within( step ).findByRole( 'button', { name: /Static.*lente.space.fast/ } )
	).toBeVisible();
	await waitFor( () =>
		expect( within( step ).getByRole( 'button', { name: 'Back' } ) ).toHaveFocus()
	);
	expect( connector.createRemoteSite ).not.toHaveBeenCalled();
	expect( connector.pushSite ).not.toHaveBeenCalled();
} );

it( 'connects a site over SSH from its address, then publishes to it', async () => {
	const sshSite = {
		id: 'deploy@acme.test:/srv/www',
		name: 'Acme',
		url: 'https://acme.test',
		contentDir: '/srv/www/wp-content',
		localSiteId: site.id,
		lastPushTimestamp: null,
		lastPullTimestamp: null,
	};
	let added = false;
	const { connector, user } = setup( {
		getRemoteSites: async ( provider ) => ( provider === 'ssh' && added ? [ sshSite ] : [] ),
		getSiteVisibility: async () => null,
		getSnapshots: async () => [],
	} );
	connector.runSitesAction.mockResolvedValue( [
		{ name: 'acme', description: 'deploy@acme.test' },
	] );
	connector.resolveRemoteSite.mockResolvedValue( sshSite );
	connector.connectRemoteSite.mockImplementation( async () => {
		added = true;
	} );
	await openShare();
	await openExistingSitePicker( user );
	const picker = await screen.findByRole( 'dialog', { name: 'Choose an existing site' } );
	expect( within( picker ).queryByRole( 'textbox' ) ).not.toBeInTheDocument();
	await user.click( within( picker ).getByRole( 'button', { name: 'Connect to SSH' } ) );
	const step = await screen.findByRole( 'dialog', { name: 'Publish over SSH' } );
	await user.click( within( step ).getByRole( 'combobox', { name: 'Host' } ) );
	await user.click( await screen.findByRole( 'option', { name: /^acme/ } ) );
	await user.type(
		within( step ).getByRole( 'textbox', { name: 'WordPress folder' } ),
		'/srv/www'
	);
	await user.click( within( step ).getByRole( 'button', { name: 'Connect' } ) );
	expect( connector.resolveRemoteSite ).toHaveBeenCalledWith( 'ssh', {
		host: 'acme',
		path: '/srv/www',
	} );
	expect( connector.connectRemoteSite ).toHaveBeenCalledWith( 'ssh', site.id, sshSite );
	expect( await screen.findByRole( 'link', { name: 'Open acme.test' } ) ).toBeVisible();

	await user.click( await screen.findByRole( 'button', { name: 'Update…' } ) );
	const confirmation = await screen.findByRole( 'alertdialog', {
		name: /Publish (again|changes)\?/,
	} );
	await user.click( within( confirmation ).getByRole( 'button', { name: /^Publish/ } ) );
	await screen.findByRole( 'button', { name: 'Updating…' } );
	act( () =>
		connector.emit( 'onSyncActivity', {
			siteId: site.id,
			activity: { kind: 'success', direction: 'push', provider: 'ssh', remoteSiteId: sshSite.id },
		} )
	);
	expect( await screen.findByRole( 'button', { name: 'Update…' } ) ).toBeEnabled();
	expect( connector.pushSite ).toHaveBeenCalledExactlyOnceWith( 'ssh', site.id, sshSite.id, {
		optionsToSync: [ 'all' ],
	} );

	await user.click( screen.getByRole( 'button', { name: 'Pull from live site…' } ) );
	const pull = await screen.findByRole( 'alertdialog', {
		name: 'Update local site from acme.test?',
	} );
	await user.click( within( pull ).getByRole( 'combobox', { name: 'What to replace' } ) );
	expect(
		( await screen.findAllByRole( 'option' ) ).map( ( option ) => option.textContent )
	).toEqual( [ 'Entire site', 'Files only', 'Content and settings only' ] );
	expect( pull ).not.toHaveTextContent( 'backup' );
} );

it( 'does not open Spacefast if its connection dialog is closed before the link is ready', async () => {
	const { connector, user } = setup( {
		getAuthUser: async () => null,
		getAiSettings: async () => aiSettings( 'wpcom', [] ),
		getRemoteSites: async () => [],
		getSnapshots: async () => [],
	} );
	let finishStart!: ( value: {
		url: string;
		code: string;
		handoff: Record< string, string >;
	} ) => void;
	connector.startProviderConnect.mockReturnValue(
		new Promise( ( resolve ) => ( finishStart = resolve ) )
	);
	connector.connectProvider.mockReturnValue( new Promise( () => {} ) );
	await openShare();
	await user.click( screen.getByRole( 'combobox', { name: 'Destination' } ) );
	await user.click( await screen.findByRole( 'option', { name: 'Spacefast' } ) );
	await user.click( screen.getByRole( 'button', { name: 'Connect to Spacefast' } ) );
	const dialog = await screen.findByRole( 'dialog', { name: 'Connect to Spacefast' } );
	await user.click( within( dialog ).getByRole( 'button', { name: 'Close' } ) );
	await act( async () =>
		finishStart( { url: 'https://auth.example.test/spacefast', code: 'ABCD', handoff: {} } )
	);
	await waitFor( () => expect( connector.connectProvider ).toHaveBeenCalledOnce() );
	expect( connector.openExternalUrl ).not.toHaveBeenCalled();
} );

it( 'keeps first publish steady through creation and upload', async () => {
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
		getSnapshots: async () => [],
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
	const panel = await openFirstDestination();
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
			{ name: site.name, visibility: 'private', input: {} },
			false
		)
	);
	expect( within( panel ).getByRole( 'button', { name: 'Publishing…' } ) ).toBeVisible();
	expect( screen.getByRole( 'button', { name: 'Publish…' } ) ).toHaveTextContent( /^Publish$/ );
	finishCreation( space );
	await waitFor( () =>
		expect( connector.pushSite ).toHaveBeenCalledExactlyOnceWith(
			'spacefast',
			site.id,
			space.id,
			undefined
		)
	);
	expect( within( panel ).getByRole( 'combobox', { name: 'Destination' } ) ).toBeDisabled();
	expect( within( panel ).getByRole( 'button', { name: 'Publishing…' } ) ).toBeVisible();
	expect(
		within( panel ).queryByRole( 'link', { name: 'Open lente.space.fast' } )
	).not.toBeInTheDocument();
	expect(
		within( panel ).queryByRole( 'button', { name: 'Manage domain' } )
	).not.toBeInTheDocument();
	expect( connector.connectRemoteSite ).not.toHaveBeenCalled();
	finishUpload();
	await waitFor( () =>
		expect( connector.connectRemoteSite ).toHaveBeenCalledWith( 'spacefast', site.id, space )
	);
	expect(
		await within( panel ).findByRole( 'link', { name: 'Open lente.space.fast' }, { timeout: 4000 } )
	).toBeEnabled();
	expect(
		within( panel ).queryByRole( 'button', { name: 'Manage domain' } )
	).not.toBeInTheDocument();
	expect(
		within( panel ).queryByText( 'Forms, comments, and search may not work on a static site.' )
	).not.toBeInTheDocument();
	expect( within( panel ).getByRole( 'button', { name: 'Publish somewhere else' } ) ).toBeVisible();
} );

it( 'returns to the chooser after creating a preview for a published WordPress.com site', async () => {
	let previews: Snapshot[] = [];
	const { connector, user } = setup( {
		getRemoteSites: async ( provider ) => ( provider === 'wpcom' ? [ live ] : [] ),
		getSnapshots: async () => previews,
		publishPreviewSite: async () => {
			previews = [ preview ];
			return { url: preview.url };
		},
	} );
	const panel = await openFirstDestination();
	expect(
		within( panel ).queryByRole( 'button', { name: 'Create preview' } )
	).not.toBeInTheDocument();
	const previewsSection = within( await openDestinations() );
	await user.click( previewsSection.getByRole( 'button', { name: 'Publish somewhere else' } ) );
	const create = screen.getByRole( 'button', { name: 'Create preview' } );
	await waitFor( () => expect( create ).toBeEnabled() );
	await user.click( create );
	expect( await previewsSection.findByRole( 'button', { name: /^Preview 1/ } ) ).toBeVisible();
	expect(
		await previewsSection.findByRole( 'button', { name: 'Publish somewhere else' } )
	).toBeVisible();
	expect( within( panel ).getByRole( 'button', { name: live.name } ) ).toBeVisible();
	await user.keyboard( '{Escape}' );
	await waitFor( () => expect( screen.queryByRole( 'dialog' ) ).not.toBeInTheDocument() );
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
	await openFirstDestination();
	await switchTo( 'lente.space.fast' );
	const row = await screen.findByRole( 'link', { name: 'Open lente.space.fast' } );
	await copyLink( user );
	await waitFor( () => expect( connector.copyText ).toHaveBeenCalledWith( space.url ) );
	fireEvent.click( row );
	expect( connector.openExternalUrl ).toHaveBeenCalledExactlyOnceWith( space.url );
} );

it( 'keeps the confirmed live state while destination metadata refreshes', async () => {
	const { connector, queryClient } = setup( {
		getRemoteSites: async ( provider ) => ( provider === 'wpcom' ? [ live ] : [] ),
		getSnapshots: async () => [],
	} );
	await openFirstDestination();
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
	expect( screen.queryByText( 'No changes' ) ).not.toBeInTheDocument();
	await act( async () => finish( { localChanged: false } ) );
} );

it( 'keeps a known destination publishable when another provider lookup fails', async () => {
	const { connector, user } = setup( {
		getRemoteSites: async ( provider ) => {
			if ( provider === 'wpcom' ) return [ live ];
			throw new Error( 'Provider unavailable' );
		},
		listAccountSites: async () => {
			throw new Error( 'Account refresh failed' );
		},
		getSitePublishStatus: async () => ( { localChanged: true } ),
		getSnapshots: async () => [],
		pushSite: async () => new Promise( () => {} ),
	} );
	await openFirstDestination();
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
} );

it( 'retains a known destination after its saved connection refresh fails', async () => {
	const { connector, queryClient } = setup( {
		getRemoteSites: async ( provider ) => ( provider === 'wpcom' ? [ live ] : [] ),
		getSnapshots: async () => [],
		getSitePublishStatus: async () => ( { localChanged: true } ),
	} );
	await openFirstDestination();
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
	await openFirstDestination();
	const notice = await screen.findByRole( 'alert' );
	expect( notice ).toHaveTextContent( 'Couldn’t load your WordPress.com sites' );
	expect( notice ).toHaveTextContent( 'Some destinations could not be loaded' );
	expect( screen.queryByRole( 'button', { name: 'Create preview' } ) ).not.toBeInTheDocument();
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
	expect( await within( notice ).findByRole( 'button', { name: 'Try again' } ) ).toHaveAttribute(
		'aria-disabled',
		'true'
	);
	expect( notice ).toBeVisible();
	await act( async () => finish( [ live ] ) );
	expect( await screen.findByRole( 'button', { name: live.name } ) ).toBeEnabled();
	expect( screen.queryByRole( 'button', { name: 'Update…' } ) ).not.toBeInTheDocument();
	expect( screen.queryByText( /Couldn’t load your .* sites/ ) ).not.toBeInTheDocument();
	expect(
		connector.getRemoteSites.mock.calls.filter( ( [ provider ] ) => provider === 'spacefast' )
	).toHaveLength( otherProviderCalls );
} );

it( 'holds publishing until the completed destination check returns', async () => {
	let finishPublish!: () => void;
	const { connector } = setup( {
		getRemoteSites: async ( provider ) => ( provider === 'spacefast' ? [ space ] : [] ),
		getSnapshots: async () => [],
		pushSite: async () => new Promise< void >( ( resolve ) => ( finishPublish = resolve ) ),
	} );
	await openFirstDestination();
	fireEvent.click( await screen.findByRole( 'button', { name: 'Update' } ) );
	await screen.findByRole( 'button', { name: 'Updating…' } );
	expect( screen.getByRole( 'time' ) ).toHaveAttribute( 'datetime', space.lastPushTimestamp );
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
	await act( async () => finishPublish() );
	expect( screen.queryByText( 'Your changes will be live in a moment.' ) ).not.toBeInTheDocument();
	expect( screen.queryByRole( 'button', { name: 'Update' } ) ).not.toBeInTheDocument();
	await act( async () => finish( { localChanged: false } ) );
	await screen.findByRole( 'button', { name: 'Update' } );
	expect( screen.getByRole( 'button', { name: 'Update' } ) ).toBeVisible();
} );

it( 'shows an actionable Publish changes button once publish checks finish', async () => {
	let finish!: ( value: number ) => void;
	setup( {
		getRemoteSites: async ( provider ) => ( provider === 'wpcom' ? [ live ] : [] ),
		getSnapshots: async () => [],
		getSitePublishStatus: async () => ( { localChanged: true } ),
		getDirectorySize: async () => new Promise( ( resolve ) => ( finish = resolve ) ),
	} );
	await openFirstDestination();
	await waitFor( () => expect( finish ).toBeDefined() );
	expect( screen.getByRole( 'button', { name: 'Checking…' } ) ).toBeVisible();
	expect( screen.queryByRole( 'button', { name: 'Update…' } ) ).not.toBeInTheDocument();
	await act( async () => finish( 1 ) );
	expect( await screen.findByRole( 'button', { name: 'Update…' } ) ).toBeEnabled();
} );

it.each( [ 'wpcom', 'spacefast' ] as const )(
	'shows the last update below the publish actions for %s destinations',
	async ( provider ) => {
		const destination = {
			...( provider === 'wpcom' ? live : space ),
			lastPushTimestamp: new Date().toISOString(),
		};
		setup( {
			getRemoteSites: async ( id ) => ( id === provider ? [ destination ] : [] ),
			listAccountSites: async ( id ) => ( id === provider ? [ destination ] : [] ),
			getSnapshots: async () => [],
			getSitePublishStatus: async () => ( { localChanged: false } ),
		} );
		const panel = within( await openFirstDestination() );
		const note = await panel.findByText( 'Last updated just now' );
		const update = panel.getByRole( 'button', {
			name: provider === 'wpcom' ? 'Update…' : 'Update',
		} );
		expect( note ).toBeVisible();
		expect( note ).toAppearAfter( update );
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
	await openFirstDestination();
	expect( screen.getByLabelText( 'Local changes' ) ).toBeVisible();
	expect( screen.queryByRole( 'button', { name: 'What to publish' } ) ).not.toBeInTheDocument();
	const publish = screen.getByRole( 'button', { name: 'Update' } );
	await waitFor( () => expect( publish ).toBeEnabled() );
	expect( screen.getByText( 'Not published yet' ) ).toAppearAfter( publish );
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
	const panel = await openFirstDestination();
	expect( within( panel ).getByRole( 'button', { name: 'Site actions' } ) ).toBeVisible();
	expect( within( panel ).queryByRole( 'button', { name: 'Copy link' } ) ).not.toBeInTheDocument();
	expect(
		await within( panel ).findByRole( 'link', { name: 'Open lente.space.fast' } )
	).toBeVisible();
	expect( within( panel ).queryByText( 'Not published yet' ) ).not.toBeInTheDocument();
	expect( screen.queryByLabelText( 'Local changes' ) ).not.toBeInTheDocument();
	await user.click( within( panel ).getByRole( 'button', { name: 'Update' } ) );
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
	expect( await screen.findByRole( 'button', { name: 'Update' } ) ).toBeVisible();
} );

it( 'hides the publish-time line when no timestamp was saved', async () => {
	setup( {
		getRemoteSites: async ( provider ) =>
			provider === 'wpcom' ? [ { ...live, lastPushTimestamp: '' } ] : [],
		getSnapshots: async () => [],
	} );
	await openFirstDestination();
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
		const panel = await openFirstDestination();
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

it( 'connects an existing site directly from the destination list', async () => {
	let connected = false;
	const second = { ...preview, atomicSiteId: 456, url: 'second.wpcomstaging.com' };
	const { connector, user } = setup( {
		getSnapshots: async () => [ preview, second ],
		getRemoteSites: async ( provider ) => ( provider === 'wpcom' && connected ? [ live ] : [] ),
		listAccountSites: async ( provider ) => ( provider === 'wpcom' ? [ live ] : [] ),
		connectRemoteSite: async () => {
			connected = true;
		},
	} );
	const panel = await openShare();
	const elsewhere = within( panel ).getByRole( 'button', { name: 'Publish somewhere else' } );
	const connect = within( panel ).getByRole( 'button', { name: 'Connect to an existing site' } );
	expect( elsewhere.nextElementSibling ).toBe( connect );
	connect.focus();
	await user.keyboard( '{Enter}' );
	let picker = await screen.findByRole( 'dialog', { name: 'Choose an existing site' } );
	expect( within( picker ).getByRole( 'button', { name: 'Back' } ) ).toHaveFocus();
	await user.keyboard( '{Escape}' );
	const returnedConnect = await screen.findByRole( 'button', {
		name: 'Connect to an existing site',
	} );
	await waitFor( () => expect( returnedConnect ).toHaveFocus() );
	await user.click( returnedConnect );
	picker = await screen.findByRole( 'dialog', { name: 'Choose an existing site' } );
	await user.click( await within( picker ).findByRole( 'button', { name: /Live.*lente.blog/ } ) );
	expect( await screen.findByRole( 'link', { name: 'Open lente.blog' } ) ).toBeVisible();
	expect( connector.connectRemoteSite ).toHaveBeenCalledExactlyOnceWith( 'wpcom', site.id, live );
	expect( connector.pushSite ).not.toHaveBeenCalled();
	expect( connector.pullSite ).not.toHaveBeenCalled();
} );

it( 'keeps a connected site visible when its account address is temporarily invalid', async () => {
	const { connector } = setup( {
		getSnapshots: async () => [],
		getRemoteSites: async ( provider ) => ( provider === 'wpcom' ? [ live ] : [] ),
		listAccountSites: async ( provider ) =>
			provider === 'wpcom' ? [ { ...live, url: '' } ] : [],
		getSiteVisibility: () => new Promise( () => {} ),
	} );
	const panel = await openShare();
	await waitFor( () => expect( connector.listAccountSites ).toHaveBeenCalledWith( 'wpcom' ) );
	expect( await within( panel ).findByRole( 'link', { name: 'Open lente.blog' } ) ).toBeVisible();
} );

it( 'offers existing sites in Destination and returns keyboard focus there', async () => {
	const { user } = setup( { getRemoteSites: async () => [], getSnapshots: async () => [] } );
	const panel = await openFirstDestination();
	expect( within( panel ).getByRole( 'button', { name: 'Create preview' } ) ).toBeVisible();
	expect(
		within( panel ).queryByRole( 'button', { name: 'More options' } )
	).not.toBeInTheDocument();
	expect(
		within( panel ).queryByRole( 'button', { name: 'Connect to an existing site' } )
	).not.toBeInTheDocument();
	const trigger = screen.getByRole( 'combobox', { name: 'Destination' } );
	trigger.focus();
	await user.keyboard( '{ArrowDown}' );
	const menu = await screen.findByRole( 'listbox' );
	const choices = within( menu );
	const [ wordpress, spacefast ] = choices.getAllByRole( 'option' );
	expect( wordpress ).toHaveAccessibleName( 'WordPress.com' );
	expect( wordpress ).toHaveAccessibleDescription( 'The full WordPress, with a domain.' );
	expect( spacefast ).toHaveAccessibleName( 'Spacefast' );
	expect( spacefast ).toHaveAccessibleDescription( 'A static copy of your pages.' );
	expect( choices.getAllByRole( 'option' ) ).toHaveLength( 4 );
	expect( choices.getAllByRole( 'option' )[ 3 ] ).toHaveAccessibleName(
		'Connect to an existing site'
	);
	expect( choices.getAllByRole( 'option' )[ 3 ] ).toHaveAccessibleDescription(
		'Publish to a site you already have.'
	);
	expect( choices.queryByRole( 'option', { name: 'Add more providers' } ) ).not.toBeInTheDocument();
	await waitFor( () => expect( wordpress ).toHaveFocus() );
	await user.keyboard( '{End}{Enter}' );
	const step = await screen.findByRole( 'dialog', { name: 'Choose an existing site' } );
	expect( step ).toBe( panel );
	expect( within( step ).getByRole( 'button', { name: 'Back' } ) ).toHaveFocus();
	await user.keyboard( '{Escape}' );
	const destination = await within( panel ).findByRole( 'combobox', {
		name: 'Destination',
	} );
	await waitFor( () => expect( destination ).toHaveFocus() );
	expect( destination ).toHaveAccessibleDescription( 'WordPress.com' );
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
		await openFirstDestination();
		await openExistingSitePicker( user );
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
	await openFirstDestination();
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
	await openFirstDestination();
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
		getRemoteSites: async ( provider ) =>
			provider === 'wpcom' ? connections : sitesOf( provider ),
		listAccountSites: async ( provider ) =>
			provider === 'wpcom' ? [ live, destination ] : sitesOf( provider ),
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
	await openFirstDestination();
	await openDestinations();
	await user.click( await screen.findByRole( 'button', { name: 'Publish somewhere else' } ) );
	await user.click( await screen.findByRole( 'button', { name: 'Create preview' } ) );
	const dialog = await screen.findByRole( 'dialog', { name: 'Live site' } );
	const select = within( dialog ).getByRole( 'combobox', { name: 'Live site' } );
	expect( select ).toHaveTextContent( 'None' );
	expect( connector.publishPreviewSite ).not.toHaveBeenCalled();
	await user.click( select );
	await user.click( await screen.findByRole( 'option', { name: 'Another live site other.blog' } ) );
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
	await openFirstDestination();
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
	await openFirstDestination();
	const previews = await openDestinations();
	expect( await within( previews ).findByText( preview.url ) ).toBeVisible();
	await user.click( within( previews ).getByRole( 'button', { name: live.name } ) );
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
	await openFirstDestination();
	await user.click( screen.getByRole( 'button', { name: 'Publish somewhere else' } ) );
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
	await waitFor( () => expect( connector.connectRemoteSite ).toHaveBeenCalledOnce() );
	await user.keyboard( '{Escape}{Escape}' );
	await openShare();
	await user.click( screen.getByRole( 'button', { name: live.name } ) );
	expect( await screen.findByRole( 'button', { name: 'Update' } ) ).toBeVisible();
	expect( connector.openExternalUrl ).toHaveBeenCalledTimes( 1 );
	expect( connector.pushSite ).not.toHaveBeenCalled();
} );

it( 'uses the shared visibility picker with Spacefast options and saves restricted access', async () => {
	const { user, connector } = setup( {
		setSiteVisibility: async () => ( { visibility: 'private', url: space.url } ),
	} );
	await selectPreview( user, 'Preview 1' );
	const previewAccess = screen.getByRole( 'combobox', { name: 'Who can view' } );
	expect( previewAccess ).toHaveTextContent( 'Anyone with the link' );
	const padlock = previewAccess.querySelector( 'svg' )?.outerHTML;
	expect( padlock ).toBeTruthy();
	await switchTo( 'lente.space.fast' );
	await user.click( screen.getByRole( 'combobox', { name: 'Who can view' } ) );
	expect( await screen.findByRole( 'option', { name: 'Everyone', selected: true } ) ).toBeVisible();
	const restricted = screen.getByRole( 'option', { name: 'Restricted' } );
	expect( restricted ).toHaveAccessibleDescription( 'Your team and people you give access to' );
	expect( restricted.querySelector( 'svg' )?.outerHTML ).toBe( padlock );
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
	expect(
		screen.getByRole( 'combobox', { name: 'Who can view' } ).querySelector( 'svg' )?.outerHTML
	).toBe( padlock );
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
	await openFirstDestination();
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

it.each( [ false, true ] )(
	'updates Spacefast directly and keeps its button label independent of local changes: %s',
	async ( localChanged ) => {
		let finish!: () => void;
		const { connector, user } = setup( {
			getRemoteSites: async ( provider ) => ( provider === 'spacefast' ? [ space ] : [] ),
			getSnapshots: async () => [],
			getSitePublishStatus: async () => ( { localChanged } ),
			pushSite: async () => new Promise< void >( ( resolve ) => ( finish = resolve ) ),
		} );
		const panel = await openFirstDestination();
		expect( within( panel ).queryByText( /^(Local changes|No changes)$/ ) ).not.toBeInTheDocument();
		const update = within( panel ).getByRole( 'button', { name: 'Update' } );
		await user.click( update );
		expect( screen.queryByRole( 'alertdialog' ) ).not.toBeInTheDocument();
		expect( await within( panel ).findByRole( 'button', { name: 'Updating…' } ) ).toHaveAttribute(
			'aria-disabled',
			'true'
		);
		expect( connector.pushSite ).toHaveBeenCalledExactlyOnceWith(
			'spacefast',
			site.id,
			space.id,
			undefined
		);
		await act( async () => finish() );
		expect( await within( panel ).findByRole( 'button', { name: 'Update' } ) ).toBeEnabled();
	}
);

it( 'confirms WordPress.com updates even when the published site has no changes', async () => {
	const { user } = setup();
	await openFirstDestination();
	await user.click( await screen.findByRole( 'button', { name: 'Update…' } ) );
	const confirmation = await screen.findByRole( 'alertdialog', { name: 'Publish again?' } );
	await user.click( within( confirmation ).getByRole( 'button', { name: 'Cancel' } ) );
	await waitFor( () => expect( screen.getByRole( 'button', { name: 'Update…' } ) ).toHaveFocus() );
} );

it( 'keeps preview creation available during a background availability refresh', async () => {
	const { connector, queryClient } = setup( {
		getSnapshots: async () => [],
		getRemoteSites: async () => [],
	} );
	await openFirstDestination();
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
	'opens details for one preview and a chooser for multiple previews (%s)',
	async ( count ) => {
		setup( {
			getRemoteSites: async () => [],
			getSnapshots: async () =>
				count === 1
					? [ preview ]
					: [ preview, { ...preview, atomicSiteId: 456, url: 'second.wpcomstaging.com' } ],
		} );
		const panel = await openShare();
		expect(
			within( panel ).getByRole( 'button', { name: 'Publish somewhere else' } )
		).toBeEnabled();
		if ( count === 1 ) {
			expect( await within( panel ).findByRole( 'button', { name: 'Update' } ) ).toBeVisible();
			expect( within( panel ).queryByRole( 'button', { name: 'Back' } ) ).not.toBeInTheDocument();
		} else {
			expect( within( panel ).getByRole( 'button', { name: 'Preview 1' } ) ).toBeVisible();
			expect( within( panel ).getByRole( 'button', { name: 'Preview 2' } ) ).toBeVisible();
			expect(
				within( panel ).queryByRole( 'button', { name: /^Update…?$/ } )
			).not.toBeInTheDocument();
		}
	}
);

it( 'keeps creation setup steady and disables navigation while creating a preview', async () => {
	const { user } = setup( {
		getRemoteSites: async () => [],
		publishPreviewSite: () => new Promise( () => {} ),
	} );
	await openShare();
	await user.click( screen.getByRole( 'button', { name: 'Publish somewhere else' } ) );
	await user.click( await screen.findByRole( 'button', { name: 'Create preview' } ) );
	expect( await screen.findByRole( 'button', { name: 'Creating preview' } ) ).toHaveAttribute(
		'aria-disabled',
		'true'
	);
	expect( screen.getByRole( 'button', { name: 'Back' } ) ).toBeDisabled();
	await user.keyboard( '{Escape}' );
	expect( screen.getByRole( 'dialog', { name: 'Publish somewhere else' } ) ).toBeVisible();
} );

it( 'keeps preview controls consistent while updating a preview', async () => {
	let finish!: ( result: { url: string } ) => void;
	const { user, connector } = setup( {
		getRemoteSites: async () => [],
		getPreviewStatus: async () => ( {
			localSiteId: site.id,
			localChanged: true,
			previewChanged: false,
		} ),
		listAccountSites: async () => [ { ...live, id: preview.atomicSiteId } ],
		getSnapshots: async () => [
			preview,
			{ ...preview, atomicSiteId: 456, url: 'second.wpcomstaging.com', date: preview.date - 1000 },
		],
		publishPreviewSite: () =>
			new Promise( ( resolve ) => {
				finish = resolve;
			} ),
	} );
	const panel = await openFirstDestination();
	const controls = within( panel );
	const switcher = controls.getByRole( 'button', { name: 'Back' } );
	const previewActions = controls.getByRole( 'button', { name: 'Preview actions' } );
	expect( controls.getByRole( 'button', { name: 'Expires' } ) ).toBeVisible();
	expect( controls.getByText( 'Anyone with the link' ) ).toBeVisible();
	expect(
		controls.queryByRole( 'button', { name: 'Publish somewhere else' } )
	).not.toBeInTheDocument();
	await user.click( controls.getByRole( 'button', { name: 'Update' } ) );
	await waitFor( () => expect( connector.publishPreviewSite ).toHaveBeenCalledOnce() );
	expect( switcher ).toBeDisabled();
	expect( previewActions ).toBeEnabled();
	await user.click( previewActions );
	const menu = await screen.findByRole( 'menu', { name: preview.name } );
	expect( within( menu ).getByRole( 'menuitem', { name: 'Pull from preview…' } ) ).toHaveAttribute(
		'aria-disabled',
		'true'
	);
	const copy = within( menu ).getByRole( 'menuitem', { name: 'Copy link' } );
	expect( copy ).toBeEnabled();
	await user.click( copy );
	expect( connector.copyText ).toHaveBeenCalledWith( preview.shareUrl );
	await act( () => finish( { url: preview.url } ) );
	await waitFor( () => {
		expect( switcher ).toBeEnabled();
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
	await openFirstDestination();
	await openExistingSitePicker( user );
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
			provider === 'wpcom' ? [ live ] : provider === 'spacefast' ? [ space, linkedSpace ] : [],
		connectRemoteSite: async () => {
			connector.getRemoteSites.mockImplementation( async ( provider, localSiteId ) =>
				provider === 'spacefast' ? ( localSiteId ? [ space ] : [ space, linkedSpace ] ) : []
			);
		},
	} );
	const panel = await openFirstDestination();
	expect(
		await within( panel ).findByRole( 'group', { name: 'Preview: Preview 1' } )
	).toBeVisible();
	await openExistingSitePicker( user );
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
	await openFirstDestination();
	await openExistingSitePicker( user );
	const dialog = within( await screen.findByRole( 'dialog', { name: 'Choose an existing site' } ) );
	expect( await dialog.findByRole( 'alert' ) ).toHaveTextContent(
		'Could not load Spacefast sites.'
	);
	expect( dialog.getByRole( 'button', { name: /Live.*lente.blog/ } ) ).toBeEnabled();
} );

it( 'offers publishing somewhere else without disconnecting the current site', async () => {
	const { user, connector } = setup( {
		getRemoteSites: async ( provider ) => ( provider === 'wpcom' ? [ live ] : [] ),
		getSnapshots: async () => [],
	} );
	await openFirstDestination();
	const actions = await openSiteActions( user );
	expect(
		within( actions ).queryByRole( 'menuitem', { name: 'Change destination…' } )
	).not.toBeInTheDocument();
	await user.keyboard( '{Escape}' );
	await user.click( screen.getByRole( 'button', { name: 'Publish somewhere else' } ) );
	expect( await screen.findByRole( 'combobox', { name: 'Destination' } ) ).toBeVisible();
	expect( connector.disconnectRemoteSite ).not.toHaveBeenCalled();
	expect( connector.connectRemoteSite ).not.toHaveBeenCalled();
} );

it.each( [ 'spacefast', 'wpcom' ] as const )(
	'connects an existing %s site from Publish somewhere else',
	async ( provider ) => {
		const destination =
			provider === 'wpcom'
				? { ...live, id: 43, name: 'Another site', url: 'https://another.blog' }
				: { ...space, id: 'spc_2', name: 'Another site', url: 'https://another.blog' };
		let connected = false;
		const { user, connector } = setup( {
			getSnapshots: async () => [],
			getRemoteSites: async ( id ) =>
				connected ? ( id === provider ? [ destination ] : [] ) : id === 'wpcom' ? [ live ] : [],
			listAccountSites: async ( id ) => [
				...( id === 'wpcom' ? [ live ] : [] ),
				...( id === provider ? [ destination ] : [] ),
			],
			connectRemoteSite: async () => {
				connected = true;
			},
			getSiteVisibility: async () => ( { url: destination.url, visibility: 'public' } ),
		} );
		await openFirstDestination();
		await user.click( screen.getByRole( 'button', { name: 'Publish somewhere else' } ) );
		if ( provider === 'spacefast' ) {
			await user.click( screen.getByRole( 'combobox', { name: 'Destination' } ) );
			await user.click( await screen.findByRole( 'option', { name: 'Spacefast' } ) );
		}
		await openExistingSitePicker( user );
		const dialog = within(
			await screen.findByRole( 'dialog', { name: 'Choose an existing site' } )
		);
		expect( dialog.getByText( /Connecting an existing site will disconnect/ ) ).toBeVisible();
		expect( connector.connectRemoteSite ).not.toHaveBeenCalled();
		await user.click( await dialog.findByRole( 'button', { name: /Another site.*another.blog/ } ) );
		expect( await screen.findByRole( 'link', { name: 'Open another.blog' } ) ).toBeVisible();
		expect( connector.connectRemoteSite ).toHaveBeenCalledExactlyOnceWith(
			provider,
			site.id,
			destination
		);
		expect( connector.disconnectRemoteSite ).not.toHaveBeenCalled();
		expect( connector.pushSite ).not.toHaveBeenCalled();
		expect( connector.pullSite ).not.toHaveBeenCalled();
	}
);

it( 'opens the selected preview’s launch URL without creating or publishing a site', async () => {
	const second = {
		...preview,
		atomicSiteId: 456,
		url: 'second.wpcomstaging.com',
		launchUrl:
			'https://wordpress.com/setup/launch-site?siteId=456&checkout_source=studio-preview-site',
		expiresAt: new Date( '2027-03-15T12:00:00Z' ).getTime(),
	};
	const { user, connector } = setup( {
		getSnapshots: async () => [ preview, second ],
		getRemoteSites: async () => [],
	} );
	const panel = await openShare();
	await user.click( getDestinationRow( panel, second.url ) );
	expect( screen.getByText( 'Mar 15' ) ).toBeVisible();
	expect( screen.getByRole( 'button', { name: 'Expires' } ) ).toHaveAttribute(
		'aria-haspopup',
		'dialog'
	);
	expect( connector.openExternalUrl ).not.toHaveBeenCalled();
	await user.click( screen.getByRole( 'button', { name: 'Launch on WordPress.com' } ) );
	await waitFor( () =>
		expect( connector.openExternalUrl ).toHaveBeenCalledExactlyOnceWith( second.launchUrl )
	);
	expect( connector.getPublishCheckoutUrl ).not.toHaveBeenCalled();
	expect( connector.watchForPublishedSite ).not.toHaveBeenCalled();
	expect( connector.publishPreviewSite ).not.toHaveBeenCalled();
	expect( connector.createRemoteSite ).not.toHaveBeenCalled();
	expect( connector.pushSite ).not.toHaveBeenCalled();
} );

it( 'lets a preview switch between a share link and launching that same preview for everyone', async () => {
	const second = {
		...preview,
		atomicSiteId: 456,
		url: 'second.wpcomstaging.com',
		launchUrl: 'https://wordpress.com/setup/launch-site?siteId=456',
	};
	const { user, connector } = setup( {
		getRemoteSites: async () => [],
		getSnapshots: async () => [ preview, second ],
		getPreviewStatus: async () => ( {
			localSiteId: site.id,
			localChanged: true,
			previewChanged: false,
		} ),
	} );
	const panel = await openShare();
	await user.click( getDestinationRow( panel, second.url ) );
	const access = within( panel ).getByRole( 'combobox', { name: 'Who can view' } );
	const choose = async ( name: string ) => {
		await user.click( access );
		await user.click( await screen.findByRole( 'option', { name } ) );
	};

	expect( access ).toHaveAttribute( 'data-variant', 'ghost' );
	expect( access ).toHaveTextContent( /^Anyone with the link$/ );
	const linkIcon = access.querySelector( 'svg' )?.innerHTML;
	expect( linkIcon ).toBeTruthy();
	await user.click( access );
	const everyone = await screen.findByRole( 'option', { name: 'Everyone' } );
	const everyoneIcon = everyone.querySelector( 'svg' )?.innerHTML;
	expect( everyoneIcon ).toBeTruthy();
	expect( everyoneIcon ).not.toBe( linkIcon );
	await user.click( everyone );
	expect( access ).toHaveTextContent( /^Everyone$/ );
	expect( access.querySelector( 'svg' )?.innerHTML ).toBe( everyoneIcon );
	expect( access ).toHaveAccessibleDescription( 'Everyone' );
	expect(
		within( panel ).queryByRole( 'button', { name: 'Launch on WordPress.com' } )
	).not.toBeInTheDocument();
	await choose( 'Anyone with the link' );
	expect( access.querySelector( 'svg' )?.innerHTML ).toBe( linkIcon );
	expect( within( panel ).getByRole( 'button', { name: 'Update' } ) ).toBeVisible();
	await choose( 'Everyone' );
	expect( connector.openExternalUrl ).not.toHaveBeenCalled();
	const proceed = within( panel ).getByRole( 'button', { name: 'Continue on WordPress.com' } );
	expect( proceed ).toHaveAttribute( 'data-variant', 'accent' );
	connector.openExternalUrl.mockRejectedValueOnce( new Error( 'Could not open browser' ) );
	await user.click( proceed );
	expect( await within( panel ).findByRole( 'alert' ) ).toHaveTextContent(
		'Could not open browser'
	);
	expect( access ).toHaveAccessibleDescription( 'Everyone' );
	await user.click( proceed );
	await waitFor( () => expect( access ).toHaveAccessibleDescription( 'Anyone with the link' ) );
	expect( connector.openExternalUrl ).toHaveBeenLastCalledWith( second.launchUrl );
	expect( connector.setSiteVisibility ).not.toHaveBeenCalled();
	expect( connector.getPublishCheckoutUrl ).not.toHaveBeenCalled();
	expect( connector.watchForPublishedSite ).not.toHaveBeenCalled();
	expect( connector.publishPreviewSite ).not.toHaveBeenCalled();
	expect( connector.pushSite ).not.toHaveBeenCalled();
} );

it.each( [ undefined, live.id ] )(
	'shows expiration without upgrade actions for an unavailable launch (live site %s)',
	async ( liveSiteId ) => {
		const { connector } = setup( {
			getRemoteSites: async () => [],
			getSnapshots: async () => [
				{
					...preview,
					launchUrl: liveSiteId ? preview.launchUrl : undefined,
					liveSiteId,
					date: new Date( '2027-03-08T12:00:00Z' ).getTime(),
				},
			],
		} );
		await openShare();
		expect( screen.getByText( 'Mar 15' ) ).toBeVisible();
		expect( screen.getByText( 'Anyone with the link' ) ).toBeVisible();
		expect( screen.queryByRole( 'combobox', { name: 'Who can view' } ) ).not.toBeInTheDocument();
		expect(
			screen.queryByRole( 'button', { name: 'Launch on WordPress.com' } )
		).not.toBeInTheDocument();
		expect( connector.openExternalUrl ).not.toHaveBeenCalled();
		expect( screen.getByRole( 'button', { name: 'Expires' } ) ).toHaveAttribute(
			'aria-haspopup',
			'dialog'
		);
	}
);

it( 'keeps preview details available to retry a failed browser handoff', async () => {
	const { user, connector } = setup( { getRemoteSites: async () => [] } );
	connector.openExternalUrl.mockRejectedValueOnce( new Error( 'Could not open browser' ) );
	await openShare();
	await user.click( screen.getByRole( 'button', { name: 'Launch on WordPress.com' } ) );
	expect( await screen.findByRole( 'alert' ) ).toHaveTextContent( 'Could not open browser' );
	await user.click( screen.getByRole( 'button', { name: 'Launch on WordPress.com' } ) );
	await waitFor( () => expect( connector.openExternalUrl ).toHaveBeenCalledTimes( 2 ) );
	expect( connector.openExternalUrl ).toHaveBeenLastCalledWith( preview.launchUrl );
	expect( screen.queryByRole( 'alert' ) ).not.toBeInTheDocument();
} );

it.each( [ 'private', 'coming-soon', 'public' ] as const )(
	'shows the paid plan independently of %s visibility',
	async ( visibility ) => {
		const paid = { ...live, hasPaidPlan: true, planName: 'Business' };
		const { user, connector } = setup( {
			getSnapshots: async () => [],
			getRemoteSites: async ( provider ) => ( provider === 'wpcom' ? [ paid ] : [] ),
			listAccountSites: async ( provider ) => ( provider === 'wpcom' ? [ paid ] : [] ),
			getSiteVisibility: async () => ( {
				url: paid.url,
				visibility,
				launchStatus: visibility === 'public' ? 'launched' : 'unlaunched',
			} ),
		} );
		const panel = await openShare();
		await user.click( await within( panel ).findByRole( 'button', { name: 'Plan Business' } ) );
		expect( connector.openExternalUrl ).toHaveBeenLastCalledWith(
			'https://wordpress.com/plans/my-plan/lente.blog'
		);
		expect(
			within( panel ).queryByRole( 'button', {
				name: /^(Expires|Launch on WordPress\.com|Add a domain)/,
			} )
		).not.toBeInTheDocument();
		expect( within( panel ).getByRole( 'combobox', { name: 'Who can view' } ) ).toBeVisible();
		await openSiteActions( user );
		await user.click( screen.getByRole( 'menuitem', { name: 'Manage domains' } ) );
		expect( connector.openExternalUrl ).toHaveBeenLastCalledWith(
			'https://my.wordpress.com/sites/lente.blog/domains'
		);
		expect( connector.pushSite ).not.toHaveBeenCalled();
	}
);

it.each( [
	{ name: 'free', hasPaidPlan: false, isPressable: false },
	{ name: 'unknown', hasPaidPlan: undefined, isPressable: false },
	{ name: 'Pressable', hasPaidPlan: true, isPressable: true },
] )(
	'does not claim a paid WordPress.com plan for $name sites',
	async ( { hasPaidPlan, isPressable } ) => {
		const remote = { ...live, hasPaidPlan, isPressable };
		setup( {
			getSnapshots: async () => [],
			getRemoteSites: async ( provider ) => ( provider === 'wpcom' ? [ remote ] : [] ),
			listAccountSites: async ( provider ) => ( provider === 'wpcom' ? [ remote ] : [] ),
		} );
		const panel = await openShare();
		expect( within( panel ).queryByRole( 'button', { name: /^Plan / } ) ).not.toBeInTheDocument();
		if ( isPressable )
			expect(
				within( panel ).queryByRole( 'button', { name: 'Launch on WordPress.com' } )
			).not.toBeInTheDocument();
	}
);

it( 'keeps the same site selected when checkout replaces a preview', async () => {
	let upgraded = false;
	const paid = {
		...live,
		name: 'Upgraded preview',
		id: preview.atomicSiteId,
		url: `https://${ preview.url }`,
		hasPaidPlan: true,
		planName: 'Business',
		launchStatus: 'unlaunched',
		visibility: 'coming-soon' as const,
	};
	const { user, connector } = setup( {
		getSnapshots: async () => ( upgraded ? [] : [ preview ] ),
		getRemoteSites: async ( provider ) =>
			provider === 'wpcom' ? ( upgraded ? [ live, paid ] : [ live ] ) : [],
		listAccountSites: async ( provider ) =>
			provider === 'wpcom' ? ( upgraded ? [ live, paid ] : [ live ] ) : [],
		getSiteVisibility: async ( _provider, id ) => ( {
			url: id === paid.id ? paid.url : live.url,
			visibility: 'coming-soon',
			launchStatus: 'unlaunched',
		} ),
	} );
	await openShare();
	await switchTo( preview.url );
	upgraded = true;
	await act( async () => {
		window.dispatchEvent( new Event( 'focus' ) );
	} );
	const panel = await screen.findByRole( 'dialog', { name: publishPanelName } );
	expect( await within( panel ).findByRole( 'button', { name: 'Plan Business' } ) ).toBeVisible();
	expect( within( panel ).getByRole( 'link', { name: `Open ${ preview.url }` } ) ).toBeVisible();
	expect(
		within( panel ).queryByRole( 'button', { name: /^Expires|Launch on WordPress\.com/ } )
	).not.toBeInTheDocument();
	expect( connector.pushSite ).not.toHaveBeenCalled();
	await user.click( within( panel ).getByRole( 'button', { name: 'Back' } ) );
	expect( within( panel ).getByRole( 'button', { name: 'Live' } ) ).toBeVisible();
	expect( within( panel ).queryByRole( 'button', { name: /^Preview 1/ } ) ).not.toBeInTheDocument();
} );

it.each( [
	{ state: 'one preview', previews: 1, sites: 0, name: 'Preview details' },
	{ state: 'one published site', previews: 0, sites: 1, name: 'Publish' },
	{ state: 'multiple previews', previews: 2, sites: 0, name: 'Choose a site' },
	{ state: 'a preview and a published site', previews: 1, sites: 1, name: 'Choose a site' },
	{ state: 'multiple published sites', previews: 0, sites: 2, name: 'Choose a site' },
] )(
	'gives the headerless opening view an accessible name for $state',
	async ( { previews, sites, name } ) => {
		const remotes = [
			live,
			{ ...live, id: 43, name: 'Second site', url: 'https://second.blog' },
		].slice( 0, sites );
		setup( {
			getSnapshots: async () =>
				[ preview, { ...preview, atomicSiteId: 124, url: 'second.wpcomstaging.com' } ].slice(
					0,
					previews
				),
			getRemoteSites: async ( provider ) => ( provider === 'wpcom' ? remotes : [] ),
			listAccountSites: async ( provider ) => ( provider === 'wpcom' ? remotes : [] ),
		} );
		const panel = await openShare();
		expect( panel ).toHaveAccessibleName( name );
		expect( panel.querySelector( 'header' ) ).not.toBeInTheDocument();
	}
);

it( 'opens on Destination and keeps the Publish name when the provider changes', async () => {
	const { user } = setup( {
		getSnapshots: async () => [],
		getRemoteSites: async () => [],
	} );
	const panel = await openShare();
	const destination = within( panel ).getByRole( 'combobox', { name: 'Destination' } );
	expect( panel ).toHaveAccessibleName( 'Publish' );
	expect( within( panel ).queryByRole( 'heading', { name: 'Publish' } ) ).not.toBeInTheDocument();
	expect( within( panel ).queryByRole( 'button', { name: 'Back' } ) ).not.toBeInTheDocument();
	expect( within( panel ).getByRole( 'button', { name: 'Create preview' } ) ).toBeVisible();
	await user.click( destination );
	await user.click( await screen.findByRole( 'option', { name: 'Spacefast' } ) );
	expect( panel ).toHaveAccessibleName( 'Publish' );
	expect(
		within( panel ).queryByRole( 'heading', { name: /New preview|New site|Publish/ } )
	).not.toBeInTheDocument();
	expect( within( panel ).getByRole( 'button', { name: 'Publish' } ) ).toBeVisible();
} );

it( 'keeps headings tied to the view when navigating and switching creation providers', async () => {
	const { user } = setup();
	const panel = await openShare();
	await user.click( getDestinationRow( panel, preview.url ) );
	expect( within( panel ).getByRole( 'heading', { name: 'Preview details' } ) ).toBeVisible();
	await user.click( within( panel ).getByRole( 'button', { name: 'Back' } ) );
	expect( panel ).toHaveAccessibleName( 'Choose a site' );
	expect( panel.querySelector( 'header' ) ).not.toBeInTheDocument();
	await user.click( within( panel ).getByRole( 'button', { name: 'Publish somewhere else' } ) );
	expect( panel ).toHaveAccessibleName( 'Publish somewhere else' );
	await user.click( within( panel ).getByRole( 'combobox', { name: 'Destination' } ) );
	await user.click( await screen.findByRole( 'option', { name: 'Spacefast' } ) );
	expect( panel ).toHaveAccessibleName( 'Publish somewhere else' );
	expect(
		within( panel ).getByRole( 'heading', { name: 'Publish somewhere else' } )
	).toBeVisible();
	await user.keyboard( '{Escape}' );
	await waitFor( () => expect( panel ).toHaveAccessibleName( 'Choose a site' ) );
	await user.click( getDestinationRow( panel, live.url.replace( 'https://', '' ) ) );
	expect( panel ).toHaveAccessibleName( 'Publish' );
} );

it( 'keeps a selected folder from becoming an entire-site pull when its backup disappears', async () => {
	let backup: string | null = 'previous-backup';
	const { user, connector } = setup( {
		getRemoteSites: async ( provider ) => ( provider === 'wpcom' ? [ live ] : [] ),
		getSnapshots: async () => [],
		getRemoteBackupId: async () => backup,
		listRemoteBackupFiles: async () => ( {
			themes: { type: 'dir', id: 'folder-1', has_children: true },
		} ),
	} );
	await openShare();
	const openPull = async () => {
		await user.click( await screen.findByRole( 'button', { name: 'Pull from live site…' } ) );
		return within( await screen.findByRole( 'alertdialog' ) );
	};
	let dialog = await openPull();
	const initialScope = dialog.getByRole( 'combobox', { name: 'What to replace' } );
	await waitFor( () => expect( initialScope ).toBeEnabled() );
	await user.click( initialScope );
	await user.click( await screen.findByRole( 'option', { name: 'Choose files…' } ) );
	await user.click( await dialog.findByRole( 'checkbox', { name: 'themes' } ) );
	expect( dialog.getByRole( 'button', { name: 'Replace selected content' } ) ).toBeEnabled();
	await user.click( dialog.getByRole( 'button', { name: 'Cancel' } ) );
	backup = null;
	dialog = await openPull();
	expect( await dialog.findByText( /Your selected files are unavailable/ ) ).toBeVisible();
	const scope = dialog.getByRole( 'combobox', { name: 'What to replace' } );
	expect( scope ).toHaveTextContent( 'Choose files…' );
	const confirm = dialog.getByRole( 'button', { name: 'Replace selected content' } );
	expect( confirm ).toBeDisabled();
	await user.click( confirm );
	expect( connector.pullSite ).not.toHaveBeenCalled();
	await waitFor( () => expect( scope ).toBeEnabled() );
	await user.click( scope );
	await user.click( await screen.findByRole( 'option', { name: 'Files only' } ) );
	expect( confirm ).toBeEnabled();
} );

it.each( [
	{
		syncSupport: 'syncable',
		pushNeedsUpgrade: true,
		allowed: true,
		notice: 'Publishing requires a supported plan.',
	},
	{
		syncSupport: 'needs-upgrade',
		pushNeedsUpgrade: true,
		allowed: false,
		notice: 'Publishing requires a supported plan.',
	},
	{
		syncSupport: 'missing-permissions',
		pushNeedsUpgrade: false,
		allowed: false,
		notice: 'You need administrator access to publish or pull changes.',
	},
] as const )(
	'checks live Pull independently of publishing for $syncSupport',
	async ( { syncSupport, pushNeedsUpgrade, allowed, notice } ) => {
		const remote = { ...live, syncSupport, pushNeedsUpgrade };
		const { user, connector } = setup( {
			getSnapshots: async () => [],
			getRemoteSites: async ( provider ) => ( provider === 'wpcom' ? [ remote ] : [] ),
			listAccountSites: async ( provider ) => ( provider === 'wpcom' ? [ remote ] : [] ),
		} );
		const panel = await openShare();
		const pull = within( panel ).queryByRole( 'button', { name: 'Pull from live site…' } );
		const status = await within( panel ).findByText( notice );
		const action = allowed ? pull! : within( panel ).getByRole( 'button', { name: 'Update…' } );
		expect( status ).toBeVisible();
		expect(
			action.compareDocumentPosition( status ) & Node.DOCUMENT_POSITION_FOLLOWING
		).toBeTruthy();
		if ( allowed ) {
			expect( pull ).toHaveAttribute( 'data-variant', 'accent' );
			await user.click( pull! );
			expect(
				await screen.findByRole( 'alertdialog', { name: 'Update local site from lente.blog?' } )
			).toBeVisible();
		} else {
			expect( pull ).not.toBeInTheDocument();
			expect( action ).toBeDisabled();
		}
		expect( connector.pullSite ).not.toHaveBeenCalled();
	}
);

it( 'opens a failed account lookup in Publish and retries into the empty setup', async () => {
	const { user, connector } = setup( {
		getSnapshots: async () => [],
		getRemoteSites: async () => [],
		getAiSettings: async () => {
			throw new Error( 'Unavailable' );
		},
	} );
	fireEvent.click( await screen.findByRole( 'button', { name: 'Publish…' } ) );
	const panel = await screen.findByRole( 'dialog', { name: 'Publish' } );
	expect( await within( panel ).findByText( 'Couldn’t load publishing accounts' ) ).toBeVisible();
	connector.getAiSettings.mockResolvedValue( aiSettings( 'wpcom', [ 'wpcom' ] ) );
	await user.click( within( panel ).getByRole( 'button', { name: 'Try again' } ) );
	expect( await within( panel ).findByRole( 'combobox', { name: 'Destination' } ) ).toBeVisible();
	expect( panel ).toHaveAccessibleName( 'Publish' );
} );

it( 'opens setup when retrying destinations returns an empty list', async () => {
	const { user, connector } = setup( {
		getSnapshots: async () => {
			throw new Error( 'Unavailable' );
		},
		getRemoteSites: async () => [],
	} );
	const panel = await openShare();
	expect(
		await within( panel ).findByText( 'Some destinations could not be loaded' )
	).toBeVisible();
	connector.getSnapshots.mockResolvedValue( [] );
	await user.click( within( panel ).getByRole( 'button', { name: 'Try again' } ) );
	expect( await within( panel ).findByRole( 'combobox', { name: 'Destination' } ) ).toBeVisible();
	expect( panel ).toHaveAccessibleName( 'Publish' );
} );

it( 'opens the linked live site and returns to the preview that opened it', async () => {
	const { user } = setup( { getSnapshots: async () => [ { ...preview, liveSiteId: live.id } ] } );
	await openShare();
	await selectPreview( user, 'Preview 1' );
	expect( screen.getByText( 'Anyone with the link' ) ).toBeVisible();
	await user.click( screen.getByRole( 'button', { name: 'Changes to Live' } ) );
	const published = await screen.findByRole( 'dialog', { name: 'Publish' } );
	expect( within( published ).getByRole( 'link', { name: 'Open lente.blog' } ) ).toBeVisible();
	await user.keyboard( '{Escape}' );
	expect( screen.getByRole( 'dialog', { name: 'Preview details' } ) ).toBeVisible();
	expect( screen.getByRole( 'button', { name: 'Changes to Live' } ) ).toHaveFocus();
} );

it( 'updates a preview with no remote edits even when local edit history is missing', async () => {
	const { user, connector } = setup( {
		getRemoteSites: async () => [],
		getPreviewStatus: async () => ( {
			localSiteId: site.id,
			localChanged: null,
			previewChanged: false,
		} ),
	} );
	const panel = await openShare();
	const update = await within( panel ).findByRole( 'button', { name: 'Update' } );
	expect( within( panel ).queryByText( /couldn’t compare/i ) ).not.toBeInTheDocument();
	expect( getVisibleToasts().filter( ( item ) => item.intent === 'error' ) ).toHaveLength( 0 );
	await user.click( update );
	await waitFor( () =>
		expect( connector.publishPreviewSite ).toHaveBeenCalledExactlyOnceWith(
			site.id,
			preview.url,
			undefined
		)
	);
} );

it( 'reports a failed preview check in a notice and rechecks without uploading', async () => {
	const { user, connector } = setup( {
		getRemoteSites: async () => [],
		getPreviewStatus: async () => {
			throw new Error( 'Status unavailable' );
		},
	} );
	const notices = () =>
		getVisibleToasts().filter( ( item ) => ! item.leaving && item.intent === 'error' );
	await waitFor( () => expect( connector.getPreviewStatus ).toHaveBeenCalledWith( preview.url ) );
	expect( notices() ).toHaveLength( 0 );
	const panel = await openShare();
	await waitFor( () =>
		expect( notices() ).toMatchObject( [
			{
				title: 'Couldn’t check for preview edits',
				description: `Updating ${ preview.url } will replace any edits made on the preview with your local copy.`,
				action: { label: 'Check again' },
			},
		] )
	);
	expect( within( panel ).queryByText( /couldn’t (compare|check)/i ) ).not.toBeInTheDocument();
	const checks = connector.getPreviewStatus.mock.calls.length;
	await user.click( within( panel ).getByRole( 'button', { name: 'Update…' } ) );
	await waitFor( () =>
		expect( connector.getPreviewStatus.mock.calls.length ).toBeGreaterThan( checks )
	);
	await within( panel ).findByRole( 'button', { name: 'Update…' } );
	expect( notices() ).toHaveLength( 1 );
	expect( connector.publishPreviewSite ).not.toHaveBeenCalled();
	await act( () => runNoticeAction( notices()[ 0 ].action! ) );
	expect( notices() ).toMatchObject( [ { title: 'Couldn’t check for preview edits' } ] );
	connector.getPreviewStatus.mockResolvedValue( {
		localSiteId: site.id,
		localChanged: true,
		previewChanged: false,
	} );
	await act( () => runNoticeAction( notices()[ 0 ].action! ) );
	expect( await within( panel ).findByRole( 'button', { name: 'Update' } ) ).toBeEnabled();
	expect( notices() ).toHaveLength( 0 );
	expect( connector.publishPreviewSite ).not.toHaveBeenCalled();
} );

it( 'keeps the local copy and preview available when the account cannot pull remote edits', async () => {
	const { user, connector } = setup( {
		getRemoteSites: async () => [],
		getPreviewStatus: async () => ( {
			localSiteId: site.id,
			localChanged: false,
			previewChanged: true,
		} ),
		listAccountSites: async () => [
			{ ...live, id: preview.atomicSiteId, syncSupport: 'needs-upgrade' },
		],
	} );
	const panel = await openShare();
	const notice = await within( panel ).findByText( /hosting plan that supports pulling/ );
	const update = within( panel ).getByRole( 'button', { name: 'Update…' } );
	expect( notice ).toBeVisible();
	expect( notice ).toAppearAfter( update );
	expect( update ).toHaveAttribute( 'data-variant', 'accent' );
	expect(
		within( panel ).queryByRole( 'button', { name: 'Pull from preview…' } )
	).not.toBeInTheDocument();
	await user.click( within( panel ).getByRole( 'button', { name: 'Preview actions' } ) );
	expect( await screen.findByRole( 'menuitem', { name: 'Copy link' } ) ).toBeEnabled();
	expect( screen.queryByRole( 'menuitem', { name: /^Update…?$/ } ) ).not.toBeInTheDocument();
	expect(
		screen.queryByRole( 'menuitem', { name: 'Pull from preview…' } )
	).not.toBeInTheDocument();
	expect( connector.pullSite ).not.toHaveBeenCalled();
} );

it( 'keeps the preview availability retry below the create action', async () => {
	const { user, connector } = setup( {
		getSnapshots: async () => [],
		getRemoteSites: async () => [],
		getSnapshotUsage: async () => {
			throw new Error( 'Unavailable' );
		},
	} );
	const panel = await openShare();
	const status = await within( panel ).findByText( 'Couldn’t check previews.' );
	const create = within( panel ).getByRole( 'button', { name: 'Create preview' } );
	expect( create ).toBeDisabled();
	expect( status ).toAppearAfter( create );
	connector.getSnapshotUsage.mockResolvedValue( {
		siteCount: 0,
		siteLimit: 5,
		siteCreationBlocked: false,
	} );
	await user.click( within( status ).getByRole( 'button', { name: 'Retry' } ) );
	await waitFor( () => expect( create ).toBeEnabled() );
	expect( status ).not.toBeInTheDocument();
} );

it( 'opens the first preview after destinations recover during creation', async () => {
	let snapshots: Snapshot[] = [];
	let failConnections = false;
	let finish!: ( result: { url: string } ) => void;
	const { connector, queryClient, user } = setup( {
		getSnapshots: async () => snapshots,
		getRemoteSites: async ( provider ) => {
			if ( provider === 'wpcom' && failConnections ) throw new Error( 'Temporarily unavailable' );
			return [];
		},
		publishPreviewSite: () => new Promise( ( resolve ) => ( finish = resolve ) ),
	} );
	const panel = await openShare();
	await user.click( within( panel ).getByRole( 'button', { name: 'Create preview' } ) );
	await waitFor( () => expect( finish ).toBeTypeOf( 'function' ) );

	snapshots = [ preview ];
	failConnections = true;
	act( () =>
		connector.emit( 'onSnapshotEvent', {
			event: SNAPSHOT_EVENTS.CREATED,
			snapshotUrl: preview.url,
			snapshot: preview,
		} )
	);
	await waitFor( () =>
		expect( queryClient.getQueryState( remoteSitesQueryKey( 'wpcom', site.id ) )?.status ).toBe(
			'error'
		)
	);
	act( () =>
		connector.emit( 'onSyncActivity', {
			siteId: site.id,
			activity: { kind: 'success', direction: 'preview' },
		} )
	);
	expect( await screen.findByRole( 'alert' ) ).toHaveTextContent(
		'Some destinations could not be loaded'
	);

	failConnections = false;
	await act( async () => {
		await queryClient.invalidateQueries( { queryKey: remoteSitesQueryKey( 'wpcom', site.id ) } );
	} );
	expect( await screen.findByRole( 'dialog', { name: 'Preview details' } ) ).toBeVisible();
	await act( async () => finish( { url: preview.url } ) );
} );

it( 'keeps launch secondary after creating a standalone preview and opens its checkout', async () => {
	let snapshots: Snapshot[] = [];
	const { user, connector } = setup( {
		getRemoteSites: async () => [],
		getSnapshots: async () => snapshots,
		publishPreviewSite: async () => {
			snapshots = [ preview ];
			return { url: preview.url };
		},
	} );
	const panel = await openShare();
	expect(
		within( panel ).getByRole( 'button', { name: 'Launch on WordPress.com' } )
	).toHaveAttribute( 'data-variant', 'outline' );
	await user.click( within( panel ).getByRole( 'button', { name: 'Create preview' } ) );
	const details = await screen.findByRole( 'dialog', { name: 'Preview details' } );
	expect( await within( details ).findByRole( 'button', { name: 'Update' } ) ).toHaveAttribute(
		'data-variant',
		'accent'
	);
	const launch = within( details ).getByRole( 'button', { name: 'Launch on WordPress.com' } );
	expect( launch ).toHaveAttribute( 'data-variant', 'outline' );
	await user.click( launch );
	await waitFor( () =>
		expect( connector.openExternalUrl ).toHaveBeenCalledExactlyOnceWith( preview.launchUrl )
	);
	expect( connector.getPublishCheckoutUrl ).not.toHaveBeenCalled();
	expect( connector.watchForPublishedSite ).not.toHaveBeenCalled();
	expect( connector.createRemoteSite ).not.toHaveBeenCalled();
} );

it( 'dismisses Publish after a failed transfer while focus remains in its notification', async () => {
	let rejectPush!: ( error: Error ) => void;
	const { user, connector } = setup(
		{
			getSnapshots: async () => [],
			getRemoteSites: async ( provider ) => ( provider === 'spacefast' ? [ space ] : [] ),
			pushSite: () =>
				new Promise< void >( ( _resolve, reject ) => {
					rejectPush = reject;
				} ),
		},
		true
	);
	const panel = await openShare();
	const backdrop = panel.parentElement!.previousElementSibling;
	expect( backdrop ).toBeInTheDocument();
	await user.click( within( panel ).getByRole( 'button', { name: 'Update' } ) );
	await waitFor( () => expect( connector.pushSite ).toHaveBeenCalled() );
	expect( backdrop ).toBeInTheDocument();
	await act( async () => rejectPush( new Error( 'Failed to start WordPress server' ) ) );
	expect( backdrop ).toBeInTheDocument();
	const notice = await screen.findByRole( 'dialog', { name: 'Publishing didn’t finish' } );
	const logs = within( notice ).getByRole( 'button', { name: 'Open logs' } );
	await user.click( logs );
	expect( panel ).toBeVisible();
	expect( logs ).toHaveFocus();
	await user.click( document.body );
	await waitFor( () => expect( panel ).not.toBeInTheDocument() );
} );
