import { SNAPSHOT_EVENTS } from '@studio/common/lib/cli-events';
import { TRACKS_EVENTS } from '@studio/common/lib/record-tracks-event';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { getVisibleToasts } from '@/data/app-messages';
import { buildPublishCheckoutUrl } from '@/data/core/connectors/publish-checkout-url';
import { applySyncActivity } from '@/data/sync-activity';
import { requestHeaderPanel } from '@/data/use-open-header-panel';
import { createFakeConnector, makeSite, TEST_USER } from '@/test/fake-connector';
import { renderWithProviders } from '@/test/render';
import { PublishButton, ShareButton } from './index';
import type { Connector, Snapshot, SyncSite } from '@/data/core';

let siteCount = 0;
const publishPanelName = /^(Choose a site|Preview details|Publish|Publish somewhere else)$/;

function pullablePreview( id: number ): SyncSite {
	return {
		id,
		localSiteId: '',
		name: 'Preview',
		url: 'https://preview.example.com',
		isStaging: false,
		isPressable: false,
		syncSupport: 'syncable',
		lastPullTimestamp: null,
		lastPushTimestamp: null,
	};
}

function setup( overrides: Partial< Connector > = {}, signedIn = true ) {
	const site = makeSite( { id: `delivery-${ ++siteCount }` } );
	let snapshots: Snapshot[] = [];
	const connector = createFakeConnector(
		{ sites: [ site ], user: signedIn ? TEST_USER : null },
		{
			getPublishCheckoutUrl: buildPublishCheckoutUrl,
			getSnapshots: async () => snapshots,
			getSnapshotUsage: async () => ( { siteCount: 0, siteLimit: 5, siteCreationBlocked: false } ),
			publishPreviewSite: async () => {
				snapshots = [
					{
						atomicSiteId: 123,
						localSiteId: site.id,
						userId: TEST_USER.id,
						url: 'preview.example.com',
						shareUrl: 'https://preview.example.com/?preview=share',
						date: Date.now(),
						name: 'My preview',
					},
				];
				return { url: snapshots[ 0 ].shareUrl! };
			},
			...overrides,
		}
	);
	// This suite's remote-site fixtures are WordPress.com sites.
	const publishConnector = {
		...connector,
		getRemoteSites: vi.fn< Connector[ 'getRemoteSites' ] >( ( provider, siteId ) =>
			provider === 'wpcom' ? connector.getRemoteSites( provider, siteId ) : Promise.resolve( [] )
		),
		listAccountSites: vi.fn< Connector[ 'listAccountSites' ] >( ( provider ) =>
			provider === 'wpcom' ? connector.listAccountSites( provider ) : Promise.resolve( [] )
		),
	};
	renderWithProviders(
		<>
			<ShareButton site={ site } />
			<PublishButton site={ site } />
		</>,
		{ connector: publishConnector }
	);
	return connector;
}

async function selectDestination( actions: ReturnType< typeof userEvent.setup >, name: string ) {
	if ( screen.queryByRole( 'group', { name: `Preview: ${ name }` } ) ) return;
	const back = screen.queryByRole( 'button', { name: 'Back' } );
	if ( back ) await actions.click( back );
	else if ( ! screen.queryByRole( 'dialog' ) )
		await actions.click( screen.getByRole( 'button', { name: 'Share' } ) );
	const destination = await screen.findByRole( 'button', { name } );
	await waitFor( () => expect( destination ).toBeEnabled() );
	await actions.click( destination );
	await screen.findByRole( 'group', { name: `Preview: ${ name }` } );
}

async function choosePreviewAccess( actions: ReturnType< typeof userEvent.setup >, name: string ) {
	await actions.click( await screen.findByRole( 'combobox', { name: 'Who can view' } ) );
	await actions.click( await screen.findByRole( 'option', { name } ) );
}

it( 'opens the replacement panel from the Share entry point without creating anything', async () => {
	const connector = setup();
	fireEvent.click( await screen.findByRole( 'button', { name: 'Share' } ) );
	expect( await screen.findByRole( 'dialog', { name: publishPanelName } ) ).toBeVisible();
	expect( screen.queryByRole( 'button', { name: 'Previews' } ) ).not.toBeInTheDocument();
	expect( connector.publishPreviewSite ).not.toHaveBeenCalled();
} );
async function openPreviewMenu( actions: ReturnType< typeof userEvent.setup >, name: string ) {
	const rowName = `Preview: ${ name }`;
	if ( ! screen.queryByRole( 'group', { name: rowName } ) ) {
		await selectDestination( actions, name );
	}
	await screen.findByRole( 'group', { name: rowName } );
	await actions.click( screen.getByRole( 'button', { name: 'Preview actions' } ) );
	await screen.findByRole( 'menu', { name } );
}

async function copyPreviewLink( actions: ReturnType< typeof userEvent.setup > ) {
	await screen.findByRole( 'group', { name: /^Preview: / } );
	await actions.click( screen.getByRole( 'button', { name: 'Preview actions' } ) );
	await actions.click( await screen.findByRole( 'menuitem', { name: 'Copy link' } ) );
	await waitFor( () => expect( screen.queryByRole( 'menu' ) ).not.toBeInTheDocument() );
}

it( 'routes external publishing requests to the replacement panel', async () => {
	const connector = setup();
	await screen.findByRole( 'button', { name: 'Publish…' } );
	act( () =>
		requestHeaderPanel( {
			panel: 'publish',
			siteId: connector.state.sites[ 0 ].id,
			view: 'publish',
		} )
	);
	expect( await screen.findByRole( 'dialog', { name: publishPanelName } ) ).toBeVisible();
	expect( screen.queryByRole( 'button', { name: 'Previews' } ) ).not.toBeInTheDocument();
	expect( connector.pushSite ).not.toHaveBeenCalled();
} );

describe( 'Share popover', () => {
	it( 'opens without uploading and creates a preview only on request', async () => {
		const connector = setup();
		connector.getPreviewStatus.mockResolvedValue( {
			localSiteId: connector.state.sites[ 0 ].id,
			localChanged: false,
			previewChanged: false,
		} );
		const actions = userEvent.setup();
		const button = await screen.findByRole( 'button', { name: /^Publish…$/ } );
		await actions.click( button );
		expect( await screen.findByRole( 'dialog', { name: publishPanelName } ) ).toBeVisible();
		expect( screen.queryByRole( 'dialog', { name: 'Share and publish' } ) ).not.toBeInTheDocument();
		expect( connector.publishPreviewSite ).not.toHaveBeenCalled();
		await actions.click( await screen.findByRole( 'button', { name: 'Create preview' } ) );
		await waitFor( () => expect( connector.publishPreviewSite ).toHaveBeenCalledTimes( 1 ) );
		await screen.findByRole( 'group', { name: 'Preview: My preview' } );
		expect( screen.getByText( 'preview.example.com' ) ).toBeVisible();
		expect( screen.getByText( 'Anyone with the link' ) ).toBeVisible();
		await copyPreviewLink( actions );
		await waitFor( () =>
			expect( connector.copyText ).toHaveBeenCalledWith(
				'https://preview.example.com/?preview=share'
			)
		);
		await actions.click( button );
		await waitFor( () => expect( screen.queryByRole( 'dialog' ) ).not.toBeInTheDocument() );
		expect( button ).toHaveFocus();
		await actions.click( button );
		expect( await screen.findByRole( 'dialog', { name: publishPanelName } ) ).toBeVisible();
		expect( connector.publishPreviewSite ).toHaveBeenCalledTimes( 1 );
	} );
} );

it( 'unlocks a ready preview before the publishing command returns', async () => {
	let finishCommand!: ( result: { url: string } ) => void;
	const connector = setup( {
		publishPreviewSite: () =>
			new Promise( ( resolve ) => {
				finishCommand = resolve;
			} ),
	} );
	const { id: siteId } = connector.state.sites[ 0 ];
	const snapshot = {
		atomicSiteId: 123,
		localSiteId: siteId,
		userId: TEST_USER.id,
		url: 'ready-preview.example.com',
		shareUrl: 'https://ready-preview.example.com/?share=example',
		date: Date.now(),
		name: 'Ready preview',
	};
	connector.getPreviewStatus.mockResolvedValue( {
		localSiteId: siteId,
		localChanged: false,
		previewChanged: false,
	} );
	const actions = userEvent.setup();
	const trigger = await screen.findByRole( 'button', { name: 'Publish…' } );
	await actions.click( trigger );
	await actions.click( await screen.findByRole( 'button', { name: 'Create preview' } ) );
	await waitFor( () => expect( finishCommand ).toBeTypeOf( 'function' ) );

	connector.getSnapshots.mockResolvedValue( [ snapshot ] );
	act( () =>
		connector.emit( 'onSnapshotEvent', {
			event: SNAPSHOT_EVENTS.CREATED,
			snapshotUrl: snapshot.url,
			snapshot,
		} )
	);
	expect( await screen.findByRole( 'button', { name: 'Creating preview' } ) ).toHaveAttribute(
		'aria-disabled',
		'true'
	);

	act( () =>
		connector.emit( 'onSyncActivity', {
			siteId,
			activity: { kind: 'success', direction: 'preview' },
		} )
	);
	expect(
		getVisibleToasts().find( ( notice ) => notice.id === `preview-${ siteId }` )?.title
	).toBe( 'Preview link ready' );
	expect( trigger.querySelector( '[data-slot="spinner"]' ) ).not.toBeInTheDocument();
	await screen.findByRole( 'group', { name: 'Preview: Ready preview' } );
	expect( screen.getByText( 'Anyone with the link' ) ).toBeVisible();
	await copyPreviewLink( actions );
	expect( connector.copyText ).toHaveBeenCalledWith( snapshot.shareUrl );

	await act( async () => finishCommand( { url: snapshot.shareUrl } ) );
	expect( trigger.querySelector( '[data-slot="spinner"]' ) ).not.toBeInTheDocument();
	expect( connector.publishPreviewSite ).toHaveBeenCalledOnce();
	await actions.click( trigger );
	await waitFor( () => expect( screen.queryByRole( 'dialog' ) ).not.toBeInTheDocument() );
	await actions.click( trigger );
	expect( await screen.findByRole( 'group', { name: 'Preview: Ready preview' } ) ).toBeVisible();
	expect( screen.queryByText( 'Preview link ready', { selector: 'h3' } ) ).not.toBeInTheDocument();
} );

it( 'keeps a single preview upload running when the popover is reopened', async () => {
	let finish!: () => void;
	const connector = setup( {
		publishPreviewSite: async () => {
			await new Promise< void >( ( resolve ) => {
				finish = resolve;
			} );
			return { url: 'https://first-preview.example.com' };
		},
	} );
	const actions = userEvent.setup();
	const button = await screen.findByRole( 'button', { name: /^Publish…$/ } );
	await actions.click( button );
	await actions.click( await screen.findByRole( 'button', { name: 'Create preview' } ) );
	await waitFor( () => expect( connector.publishPreviewSite ).toHaveBeenCalledTimes( 1 ) );
	expect( button.querySelector( '[data-slot="spinner"]' ) ).toBeInTheDocument();
	expect(
		getVisibleToasts().some(
			( notice ) => notice.id === `preview-${ connector.state.sites[ 0 ].id }` && ! notice.leaving
		)
	).toBe( false );
	const creatingButton = screen.getByRole( 'button', { name: 'Creating preview' } );
	expect( creatingButton ).toHaveAttribute( 'aria-busy', 'true' );
	expect( creatingButton ).toHaveAttribute( 'aria-disabled', 'true' );
	expect( creatingButton.querySelector( '[data-slot="spinner"]' ) ).toBeInTheDocument();
	await actions.keyboard( '{Escape}' );
	await waitFor( () => expect( screen.queryByRole( 'dialog' ) ).not.toBeInTheDocument() );
	await actions.click( button );
	expect( await screen.findByRole( 'dialog', { name: publishPanelName } ) ).toBeVisible();
	expect( screen.getByRole( 'button', { name: 'Creating preview' } ) ).toHaveAttribute(
		'aria-disabled',
		'true'
	);
	expect( connector.publishPreviewSite ).toHaveBeenCalledTimes( 1 );
	const panel = screen.getByRole( 'dialog', { name: publishPanelName } );
	expect( within( panel ).getByText( 'Destination' ) ).toBeVisible();
	expect(
		within( panel ).getByRole( 'combobox', { name: 'Who can view' } )
	).toHaveAccessibleDescription( 'Anyone with the link' );
	expect( within( panel ).queryByRole( 'heading', { name: 'Previews' } ) ).not.toBeInTheDocument();
	expect(
		within( panel ).queryByRole( 'button', { name: 'Publish somewhere else' } )
	).not.toBeInTheDocument();
	expect( panel.querySelector( '[data-slot="preview-row-skeleton"]' ) ).not.toBeInTheDocument();

	connector.getSnapshots.mockResolvedValue( [
		{
			atomicSiteId: 123,
			localSiteId: connector.state.sites[ 0 ].id,
			userId: TEST_USER.id,
			date: Date.now(),
			url: 'first-preview.example.com',
		},
	] );
	await act( async () => finish() );
	expect(
		await within( panel ).findByRole( 'group', {
			name: 'Preview: Preview 1',
		} )
	).toBeVisible();
	expect( within( panel ).queryByText( 'Destination' ) ).not.toBeInTheDocument();
	expect( panel.querySelector( '[data-slot="preview-row-skeleton"]' ) ).not.toBeInTheDocument();
} );

it( 'opens Sharing settings from the preview limit dialog', async () => {
	const site = makeSite();
	const connector = createFakeConnector(
		{ sites: [ site ], user: TEST_USER },
		{
			getSnapshots: async () => [],
			getSnapshotUsage: async () => ( {
				siteCount: 5,
				siteLimit: 5,
				siteCreationBlocked: false,
			} ),
		}
	);
	const { history, user } = renderWithProviders( <PublishButton site={ site } />, { connector } );
	const trigger = await screen.findByRole( 'button', { name: 'Publish…' } );
	await user.click( trigger );
	const panel = await screen.findByRole( 'dialog', { name: publishPanelName } );
	const create = within( panel ).getByRole( 'button', { name: 'Create preview' } );
	await waitFor( () => expect( create ).toBeEnabled() );
	expect( within( panel ).queryByText( /preview limit/i ) ).not.toBeInTheDocument();
	await user.click( create );
	const limit = await screen.findByRole( 'alertdialog', { name: 'Preview limit reached' } );
	await user.click( within( limit ).getByRole( 'button', { name: 'Open settings' } ) );
	await waitFor( () => expect( history.location.search ).toBe( '?settings=sharing' ) );
	expect( connector.publishPreviewSite ).not.toHaveBeenCalled();
	expect( connector.openExternalUrl ).not.toHaveBeenCalled();
} );

it( 'cancels a queued creation when the popover closes before snapshots load', async () => {
	let resolveSnapshots!: ( snapshots: Snapshot[] ) => void;
	const connector = setup( {
		getSnapshots: () =>
			new Promise( ( resolve ) => {
				resolveSnapshots = resolve;
			} ),
	} );
	const actions = userEvent.setup();
	await actions.click( await screen.findByRole( 'button', { name: /^Publish…$/ } ) );
	await screen.findByRole( 'dialog', { name: publishPanelName } );
	await actions.keyboard( '{Escape}' );
	await waitFor( () => expect( screen.queryByRole( 'dialog' ) ).not.toBeInTheDocument() );
	await act( async () => resolveSnapshots( [] ) );
	expect( connector.publishPreviewSite ).not.toHaveBeenCalled();
} );

it( 'reuses an existing preview without uploading', async () => {
	const connector = setup();
	connector.getSnapshots.mockResolvedValue( [
		{
			atomicSiteId: 1,
			localSiteId: connector.state.sites[ 0 ].id,
			userId: TEST_USER.id,
			url: 'existing.example.com',
			date: Date.now(),
		},
	] );
	const actions = userEvent.setup();
	await actions.click( await screen.findByRole( 'button', { name: /^Publish…$/ } ) );
	expect( await screen.findByRole( 'dialog', { name: publishPanelName } ) ).toBeVisible();
	await waitFor( () =>
		expect(
			screen.getByRole( 'button', { name: /^Publish…$/ } ).querySelector( '[data-slot="spinner"]' )
		).not.toBeInTheDocument()
	);
	expect( connector.publishPreviewSite ).not.toHaveBeenCalled();
} );

it( 'retries failed creation only when Create preview is clicked', async () => {
	const connector = setup( {
		publishPreviewSite: async () => {
			throw new Error( 'Preview upload failed' );
		},
	} );
	const actions = userEvent.setup();
	const button = await screen.findByRole( 'button', { name: /^Publish…$/ } );
	await actions.click( button );
	expect( connector.publishPreviewSite ).toHaveBeenCalledTimes( 0 );
	await actions.click( await screen.findByRole( 'button', { name: 'Create preview' } ) );
	await waitFor( () =>
		expect(
			getVisibleToasts().some( ( toast ) => toast.description === 'Preview upload failed' )
		).toBe( true )
	);
	expect(
		screen.queryByText( 'Creating your preview', { selector: 'h3' } )
	).not.toBeInTheDocument();
	expect( document.querySelector( '[data-slot="preview-row-skeleton"]' ) ).not.toBeInTheDocument();
	expect( connector.publishPreviewSite ).toHaveBeenCalledTimes( 1 );
	await actions.keyboard( '{Escape}' );
	await waitFor( () => expect( screen.queryByRole( 'dialog' ) ).not.toBeInTheDocument() );
	await actions.click( button );
	expect( connector.publishPreviewSite ).toHaveBeenCalledTimes( 1 );
	await actions.click( await screen.findByRole( 'button', { name: 'Create preview' } ) );
	await waitFor( () => expect( connector.publishPreviewSite ).toHaveBeenCalledTimes( 2 ) );
} );

it.each( [ true, false, null ] )(
	'marks Publish only for confirmed local changes (%s)',
	async ( localChanged ) => {
		const connector = setup( {
			getPreviewStatus: async () => ( {
				localSiteId: 'local',
				localChanged,
				previewChanged: false,
			} ),
		} );
		connector.getSnapshots.mockResolvedValue( [
			{
				atomicSiteId: 1,
				localSiteId: connector.state.sites[ 0 ].id,
				userId: TEST_USER.id,
				url: 'existing.example.com',
				date: Date.now(),
				versionId: 'published-version',
			},
		] );
		await waitFor( () =>
			expect( connector.getPreviewStatus ).toHaveBeenCalledWith( 'existing.example.com' )
		);
		if ( localChanged ) {
			expect( await screen.findByRole( 'img', { name: 'Local changes' } ) ).toHaveAttribute(
				'data-tone',
				'current'
			);
			expect( await screen.findByRole( 'button', { name: /^Publish…$/ } ) ).toHaveTextContent(
				'Publish'
			);
			expect(
				screen.getByRole( 'button', { name: /^Publish…$/ } ).querySelector( 'svg' )
			).not.toBeInTheDocument();
		} else {
			expect(
				screen
					.getByRole( 'button', { name: /^Publish…$/ } )
					.querySelector( '[data-slot="notification-dot"]' )
			).not.toBeInTheDocument();
			expect( screen.getByRole( 'button', { name: /^Publish…$/ } ) ).toHaveTextContent(
				/^Publish$/
			);
		}
		expect( connector.publishPreviewSite ).not.toHaveBeenCalled();
	}
);

it( 'publishes changes to the latest preview and clears the changes label', async () => {
	let changed = true;
	let finish!: () => void;
	const connector = setup( {
		getPreviewStatus: async () => ( {
			localSiteId: 'local',
			localChanged: changed,
			previewChanged: false,
		} ),
		publishPreviewSite: async () => {
			await new Promise< void >( ( resolve ) => {
				finish = resolve;
			} );
			changed = false;
			return { url: 'https://latest.example.com/?preview=share' };
		},
	} );
	const snapshot = {
		atomicSiteId: 1,
		localSiteId: connector.state.sites[ 0 ].id,
		userId: TEST_USER.id,
		date: Date.now(),
	};
	connector.getSnapshots.mockResolvedValue( [
		{ ...snapshot, atomicSiteId: 2, url: 'older.example.com', date: Date.now() - 1000 },
		{
			...snapshot,
			url: 'latest.example.com',
			name: 'Latest preview',
			shareUrl: 'https://latest.example.com/?preview=share',
		},
	] );
	const actions = userEvent.setup();
	await actions.click( await screen.findByRole( 'button', { name: /^Publish…$/ } ) );
	await selectDestination( actions, 'Latest preview' );
	expect( screen.getByRole( 'link', { name: /^Open preview:/ } ) ).toBeVisible();
	expect( screen.getByRole( 'dialog', { name: publishPanelName } ) ).toBeVisible();
	expect(
		screen.queryByRole( 'button', { name: 'WordPress.com dashboard' } )
	).not.toBeInTheDocument();
	const update = await screen.findByRole( 'button', { name: 'Update' } );
	expect( update ).toHaveAttribute( 'data-variant', 'accent' );
	expect( screen.queryByRole( 'button', { name: 'Done' } ) ).not.toBeInTheDocument();
	await actions.click( update );
	await waitFor( () =>
		expect( connector.publishPreviewSite ).toHaveBeenCalledExactlyOnceWith(
			connector.state.sites[ 0 ].id,
			'latest.example.com',
			undefined
		)
	);
	expect( update ).toHaveAccessibleName( 'Updating…' );
	expect( update ).toHaveAttribute( 'aria-busy', 'true' );
	expect( update.querySelector( '[data-slot="spinner"]' ) ).toBeInTheDocument();
	expect( update ).toHaveAttribute( 'aria-disabled', 'true' );
	await actions.click( update );
	expect( connector.publishPreviewSite ).toHaveBeenCalledTimes( 1 );
	await act( async () => finish() );
	await screen.findByRole( 'button', { name: /^Publish…$/ } );
	expect( screen.queryByRole( 'button', { name: 'Done' } ) ).not.toBeInTheDocument();
	await waitFor( () =>
		expect( screen.getByRole( 'button', { name: 'Update' } ) ).not.toHaveAttribute(
			'aria-disabled',
			'true'
		)
	);
	expect(
		screen
			.getByRole( 'button', { name: /^Publish…$/ } )
			.querySelector( '[data-slot="notification-dot"]' )
	).not.toBeInTheDocument();
	await copyPreviewLink( actions );
	await waitFor( () =>
		expect( connector.copyText ).toHaveBeenCalledWith( 'https://latest.example.com/?preview=share' )
	);
} );

it( 'shows the server expiry and confirms deletion without recreating the preview', async () => {
	const connector = setup();
	const snapshot: Snapshot = {
		atomicSiteId: 123,
		localSiteId: connector.state.sites[ 0 ].id,
		userId: TEST_USER.id,
		date: Date.now(),
		expiresAt: new Date( 2099, 10, 17, 12 ).getTime(),
		url: 'delete.example.com',
	};
	connector.getSnapshots.mockResolvedValue( [ snapshot ] );
	connector.deleteSnapshot.mockImplementation( async () => {
		connector.getSnapshots.mockResolvedValue( [] );
	} );
	const actions = userEvent.setup();
	const trigger = await screen.findByRole( 'button', { name: /^Publish…$/ } );
	await actions.click( trigger );
	await actions.click( await screen.findByRole( 'button', { name: 'Preview actions' } ) );
	await actions.click( await screen.findByRole( 'menuitem', { name: 'Delete preview…' } ) );
	const confirmation = await screen.findByRole( 'alertdialog', { name: 'Delete preview?' } );
	expect( confirmation ).toBeVisible();
	expect( confirmation ).toHaveAccessibleDescription(
		'Anyone with the link will lose access, and this can’t be undone. Your local WordPress won’t change.'
	);
	expect( within( confirmation ).getByText( 'Expires Nov 17' ) ).toBeVisible();
	expect( within( confirmation ).queryByText( /^Updated / ) ).not.toBeInTheDocument();
	expect( screen.queryByRole( 'dialog', { name: publishPanelName } ) ).not.toBeInTheDocument();
	expect( connector.deleteSnapshot ).not.toHaveBeenCalled();
	await actions.click( screen.getByRole( 'button', { name: 'Cancel' } ) );
	await waitFor( () => expect( screen.queryByRole( 'alertdialog' ) ).not.toBeInTheDocument() );
	expect( trigger ).toHaveFocus();
	await actions.click( trigger );
	await actions.click( await screen.findByRole( 'button', { name: 'Preview actions' } ) );
	await actions.click( await screen.findByRole( 'menuitem', { name: 'Delete preview…' } ) );
	await screen.findByRole( 'alertdialog', { name: 'Delete preview?' } );
	await actions.click( screen.getByRole( 'button', { name: 'Delete preview' } ) );
	await waitFor( () =>
		expect( connector.deleteSnapshot ).toHaveBeenCalledExactlyOnceWith( 'delete.example.com' )
	);
	await waitFor( () => expect( screen.queryByRole( 'alertdialog' ) ).not.toBeInTheDocument() );
	expect( trigger ).toHaveFocus();
	expect( connector.publishPreviewSite ).not.toHaveBeenCalled();
} );

it( 'creates another preview without replacing the existing preview and copies its new link', async () => {
	let finish!: () => void;
	const connector = setup( {
		getSnapshotUsage: async () => ( { siteCount: 1, siteLimit: 5, siteCreationBlocked: false } ),
	} );
	const snapshot: Snapshot = {
		atomicSiteId: 123,
		localSiteId: connector.state.sites[ 0 ].id,
		userId: TEST_USER.id,
		date: Date.now() - 1000,
		url: 'original.example.com',
	};
	const newSnapshot = {
		...snapshot,
		atomicSiteId: 456,
		date: Date.now(),
		url: 'another.example.com',
		shareUrl: 'https://another.example.com/?share=new',
	};
	connector.getSnapshots.mockResolvedValue( [ snapshot ] );
	connector.publishPreviewSite.mockImplementation( async () => {
		await new Promise< void >( ( resolve ) => {
			finish = resolve;
		} );
		connector.getSnapshots.mockResolvedValue( [ snapshot, newSnapshot ] );
		return { url: newSnapshot.shareUrl };
	} );
	connector.getPreviewStatus.mockResolvedValue( {
		localSiteId: connector.state.sites[ 0 ].id,
		localChanged: false,
		previewChanged: false,
	} );
	const actions = userEvent.setup();
	await actions.click( await screen.findByRole( 'button', { name: /^Publish…$/ } ) );
	const panel = await screen.findByRole( 'dialog', { name: publishPanelName } );
	expect( within( panel ).queryByRole( 'heading', { name: 'Previews' } ) ).not.toBeInTheDocument();
	await actions.click( screen.getByRole( 'button', { name: 'Publish somewhere else' } ) );
	expect( connector.publishPreviewSite ).not.toHaveBeenCalled();
	await actions.click( await screen.findByRole( 'button', { name: 'Create preview' } ) );
	await waitFor( () =>
		expect( connector.publishPreviewSite ).toHaveBeenCalledExactlyOnceWith(
			snapshot.localSiteId,
			undefined,
			undefined
		)
	);
	const creating = screen.getByRole( 'button', { name: 'Creating preview' } );
	expect( creating ).toHaveAttribute( 'aria-disabled', 'true' );
	await actions.click( creating );
	expect( connector.publishPreviewSite ).toHaveBeenCalledTimes( 1 );
	expect( screen.getByRole( 'button', { name: 'Back' } ) ).toBeDisabled();
	expect( within( panel ).queryByRole( 'group', { name: /^Preview:/ } ) ).not.toBeInTheDocument();
	act( () =>
		connector.emit( 'onSnapshotEvent', {
			event: SNAPSHOT_EVENTS.CREATED,
			snapshotUrl: newSnapshot.url,
			snapshot: newSnapshot,
		} )
	);
	expect( screen.getByRole( 'button', { name: 'Creating preview' } ) ).toHaveAttribute(
		'aria-disabled',
		'true'
	);
	await act( async () => finish() );
	expect( await screen.findByRole( 'button', { name: 'Preview 2' } ) ).toBeVisible();
	expect( screen.getByRole( 'button', { name: 'Preview 1' } ) ).toBeVisible();
	await selectDestination( actions, 'Preview 2' );
	await copyPreviewLink( actions );
	await waitFor( () =>
		expect( connector.copyText ).toHaveBeenCalledWith( 'https://another.example.com/?share=new' )
	);
	expect( connector.deleteSnapshot ).not.toHaveBeenCalled();
} );

it.each( [ false, true ] )(
	'handles New preview at the limit (account blocked: %s)',
	async ( blocked ) => {
		const connector = setup( {
			getSnapshotUsage: async () => ( {
				siteCount: 5,
				siteLimit: 5,
				siteCreationBlocked: blocked,
			} ),
		} );
		connector.getSnapshots.mockResolvedValue( [
			{
				atomicSiteId: 123,
				localSiteId: connector.state.sites[ 0 ].id,
				userId: TEST_USER.id,
				date: Date.now(),
				url: 'existing.example.com',
			},
		] );
		const actions = userEvent.setup();
		const trigger = await screen.findByRole( 'button', { name: /^Publish…$/ } );
		await actions.click( trigger );
		await actions.click( await screen.findByRole( 'button', { name: 'Publish somewhere else' } ) );
		const create = await screen.findByRole( 'button', { name: 'Create preview' } );
		if ( blocked ) {
			expect( create ).toBeDisabled();
		} else {
			await waitFor( () => expect( create ).not.toHaveAttribute( 'aria-disabled', 'true' ) );
			await actions.click( create );
			const limit = await screen.findByRole( 'alertdialog', { name: 'Preview limit reached' } );
			await actions.click( within( limit ).getByRole( 'button', { name: 'Cancel' } ) );
			await waitFor( () => expect( limit ).not.toBeInTheDocument() );
			expect( trigger ).toHaveFocus();
		}
		expect( connector.publishPreviewSite ).not.toHaveBeenCalled();
	}
);

it( 'targets the selected preview for its link, expiry, changes, launch, and deletion', async () => {
	let changed = true;
	const connector = setup( {
		getPreviewStatus: async ( hostname ) => ( {
			localSiteId: 'local',
			localChanged: hostname === 'older.example.com' && changed,
			previewChanged: false,
		} ),
		publishPreviewSite: async () => {
			changed = false;
			return { url: 'https://older.example.com/?share=older' };
		},
	} );
	const base = { localSiteId: connector.state.sites[ 0 ].id, userId: TEST_USER.id };
	const newer: Snapshot = {
		...base,
		atomicSiteId: 2,
		url: 'newer.example.com',
		name: 'Newer preview',
		date: Date.now(),
		expiresAt: new Date( 2099, 10, 18, 12 ).getTime(),
	};
	const older: Snapshot = {
		...base,
		atomicSiteId: 1,
		url: 'older.example.com',
		name: 'Older preview',
		date: Date.now() - 1000,
		shareUrl: 'https://older.example.com/?share=older',
		launchUrl: 'https://wordpress.com/setup/launch-site?siteId=1',
		expiresAt: new Date( 2099, 10, 17, 12 ).getTime(),
	};
	connector.getSnapshots.mockResolvedValue( [ older, newer ] );
	connector.deleteSnapshot.mockImplementation( async () => {
		connector.getSnapshots.mockResolvedValue( [ newer ] );
	} );
	const actions = userEvent.setup();
	await actions.click( await screen.findByRole( 'button', { name: /^Publish…$/ } ) );
	expect( await screen.findByRole( 'button', { name: 'Newer preview' } ) ).toBeVisible();
	expect(
		screen.queryByRole( 'group', { name: 'Preview: Newer preview' } )
	).not.toBeInTheDocument();
	await selectDestination( actions, 'Older preview' );
	expect( screen.getByRole( 'group', { name: 'Preview: Older preview' } ) ).toBeVisible();
	expect(
		within( screen.getByRole( 'dialog', { name: publishPanelName } ) )
			.getAllByRole( 'group', { name: /^Preview:/ } )
			.map( ( row ) => row.getAttribute( 'aria-label' ) )
	).toEqual( [ 'Preview: Older preview' ] );
	await actions.click( await screen.findByRole( 'button', { name: 'Update' } ) );
	await waitFor( () =>
		expect( connector.publishPreviewSite ).toHaveBeenCalledExactlyOnceWith(
			base.localSiteId,
			older.url,
			undefined
		)
	);
	await waitFor( () =>
		expect( screen.getByRole( 'button', { name: 'Update' } ) ).not.toHaveAttribute(
			'aria-disabled',
			'true'
		)
	);
	expect( screen.getByRole( 'group', { name: 'Preview: Older preview' } ) ).toBeVisible();
	await copyPreviewLink( actions );
	expect( connector.copyText ).toHaveBeenCalledWith( older.shareUrl );
	await actions.click( screen.getByRole( 'button', { name: 'Launch on WordPress.com' } ) );
	await waitFor( () => expect( connector.openExternalUrl ).toHaveBeenCalled() );
	expect( connector.openExternalUrl ).toHaveBeenCalledWith( older.launchUrl );
	await waitFor(
		() => expect( screen.getByRole( 'link', { name: /^Open preview:/ } ) ).toBeEnabled(),
		{ timeout: 3000 }
	);
	await actions.click( await screen.findByRole( 'link', { name: /^Open preview:/ } ) );
	expect( connector.openExternalUrl ).toHaveBeenLastCalledWith( older.shareUrl );
	await selectDestination( actions, 'Newer preview' );
	expect( screen.getByRole( 'group', { name: 'Preview: Newer preview' } ) ).toBeVisible();
	expect( screen.getByRole( 'button', { name: 'Preview actions' } ) ).toBeVisible();
	await copyPreviewLink( actions );
	await waitFor( () =>
		expect( connector.copyText ).toHaveBeenLastCalledWith( 'https://newer.example.com' )
	);
	expect( connector.openExternalUrl ).toHaveBeenLastCalledWith( older.shareUrl );
} );

it( 'confirms before pulling the preview for the row and supports retry after failure', async () => {
	let finish!: () => void;
	const connector = setup( {
		listAccountSites: async () => [ pullablePreview( 123 ), pullablePreview( 456 ) ],
		getPreviewStatus: async () => ( {
			localSiteId: null,
			localChanged: false,
			previewChanged: false,
		} ),
		pullSite: async () => {
			throw new Error( 'Preview pull failed' );
		},
	} );
	const base = { localSiteId: connector.state.sites[ 0 ].id, userId: TEST_USER.id };
	connector.getSnapshots.mockResolvedValue( [
		{ ...base, atomicSiteId: 123, url: 'older.example.com', date: Date.now() - 1000 },
		{ ...base, atomicSiteId: 456, url: 'newer.example.com', date: Date.now() },
	] );
	const actions = userEvent.setup();
	const trigger = await screen.findByRole( 'button', { name: /^Publish…$/ } );
	await actions.click( trigger );
	await selectDestination( actions, 'Preview 1' );
	await openPreviewMenu( actions, 'Preview 1' );
	await actions.click( screen.getByRole( 'menuitem', { name: 'Pull from preview…' } ) );
	const dialog = await screen.findByRole( 'alertdialog', {
		name: 'Update local site from Preview 1?',
	} );
	expect( dialog ).toHaveTextContent(
		'This replaces your local site with the preview. Any local changes will be lost.'
	);
	expect( connector.pullSite ).not.toHaveBeenCalled();
	await actions.click( screen.getByRole( 'button', { name: 'Cancel' } ) );
	await waitFor( () => expect( screen.queryByRole( 'alertdialog' ) ).not.toBeInTheDocument() );
	await waitFor( () =>
		expect( screen.getByRole( 'button', { name: 'Preview actions' } ) ).toHaveFocus()
	);
	await openPreviewMenu( actions, 'Preview 1' );
	await actions.click( screen.getByRole( 'menuitem', { name: 'Pull from preview…' } ) );
	await screen.findByRole( 'alertdialog', { name: 'Update local site from Preview 1?' } );
	await actions.click( screen.getByRole( 'button', { name: 'Replace local site' } ) );
	await waitFor( () =>
		expect( connector.pullSite ).toHaveBeenCalledExactlyOnceWith(
			'wpcom',
			base.localSiteId,
			123,
			undefined
		)
	);
	expect( await screen.findByRole( 'alert' ) ).toHaveTextContent(
		'Could not update your local site from this preview. Please try again.'
	);
	expect( screen.queryByText( 'Preview pull failed' ) ).not.toBeInTheDocument();
	const pull = screen.getByRole( 'button', { name: 'Replace local site' } );
	await waitFor( () => expect( pull ).toBeEnabled(), { timeout: 3000 } );
	connector.pullSite.mockImplementation(
		() =>
			new Promise( ( resolve ) => {
				finish = resolve;
			} )
	);
	await actions.click( pull );
	await waitFor( () => expect( connector.pullSite ).toHaveBeenCalledTimes( 2 ) );
	expect( pull ).toHaveAttribute( 'aria-disabled', 'true' );
	await actions.click( pull );
	expect( connector.pullSite ).toHaveBeenCalledTimes( 2 );
	await act( async () => finish() );
	await waitFor( () => expect( screen.queryByRole( 'alertdialog' ) ).not.toBeInTheDocument() );
	await waitFor( () =>
		expect( screen.getByRole( 'button', { name: 'Preview actions' } ) ).toHaveFocus()
	);
	expect( connector.publishPreviewSite ).not.toHaveBeenCalled();
} );

it.each( [ false, true ] )(
	'shows preview edits and confirms before replacing them, local changes: %s',
	async ( localChanged ) => {
		let previewChanged = true;
		const connector = setup( {
			listAccountSites: async () => [ pullablePreview( 12 ) ],
			getPreviewStatus: async () => ( { localSiteId: 'local', localChanged, previewChanged } ),
			publishPreviewSite: async () => {
				previewChanged = false;
				return { url: 'https://edited.example.com/' };
			},
		} );
		connector.getSnapshots.mockResolvedValue( [
			{
				atomicSiteId: 12,
				localSiteId: connector.state.sites[ 0 ].id,
				userId: TEST_USER.id,
				url: 'edited.example.com',
				name: 'Client review',
				date: Date.now(),
			},
		] );
		const actions = userEvent.setup();
		await actions.click(
			await screen.findByRole( 'button', {
				name: /^Publish…$/,
			} )
		);
		const status = await screen.findByText(
			localChanged ? 'Local and preview changes' : 'Preview has changes'
		);
		expect( status ).toBeVisible();
		expect( status ).toAppearAfter( await screen.findByRole( 'button', { name: 'Update…' } ) );
		if ( localChanged ) {
			expect(
				screen.getByText( 'Pull replaces your local copy. Update replaces the preview.' )
			).toAppearAfter( status );
		}
		const pull = await screen.findByRole( 'button', { name: 'Pull from preview…' } );
		expect( pull ).toHaveAttribute( 'data-variant', 'outline' );
		await actions.click( pull );
		await screen.findByRole( 'alertdialog', { name: 'Update local site from Client review?' } );
		expect( connector.pullSite ).not.toHaveBeenCalled();
		await actions.click( screen.getByRole( 'button', { name: 'Cancel' } ) );
		expect( await screen.findByRole( 'dialog', { name: 'Preview details' } ) ).toBeVisible();
		const update = screen.getByRole( 'button', { name: 'Update…' } );
		expect( update ).toHaveAttribute( 'data-variant', 'accent' );
		expect( connector.getPreviewStatus ).toHaveBeenCalledWith( 'edited.example.com' );
		await actions.click( update );
		await screen.findByText( 'Replace preview changes?' );
		expect( connector.publishPreviewSite ).not.toHaveBeenCalled();
		expect( connector.openExternalUrl ).not.toHaveBeenCalled();
		await actions.click( screen.getByRole( 'button', { name: 'Cancel' } ) );
		expect( connector.publishPreviewSite ).not.toHaveBeenCalled();
		const restoredUpdate = await screen.findByRole( 'button', { name: 'Update…' } );
		await waitFor( () => expect( restoredUpdate ).toHaveFocus() );
		await actions.click( restoredUpdate );
		await actions.click( await screen.findByRole( 'button', { name: 'Replace preview' } ) );
		await waitFor( () =>
			expect( connector.publishPreviewSite ).toHaveBeenCalledExactlyOnceWith(
				connector.state.sites[ 0 ].id,
				'edited.example.com',
				undefined
			)
		);
		expect( connector.pushSite ).not.toHaveBeenCalled();
		expect( connector.openExternalUrl ).not.toHaveBeenCalled();
	}
);

it( 'chooses the connected website and keeps preview updates separate from live publishing', async () => {
	const connector = setup( {
		getPreviewStatus: async () => ( {
			localSiteId: 'local',
			localChanged: true,
			previewChanged: false,
		} ),
	} );
	const siteId = connector.state.sites[ 0 ].id;
	const remote = {
		id: 888,
		localSiteId: siteId,
		name: 'Published website',
		launchStatus: 'launched',
		url: 'https://published.example.com',
		isStaging: false,
		isPressable: false,
		syncSupport: 'syncable' as const,
		lastPullTimestamp: null,
		lastPushTimestamp: new Date().toISOString(),
	};
	connector.getRemoteSites.mockResolvedValue( [ remote ] );
	connector.listAccountSites.mockResolvedValue( [ remote ] );
	connector.getSnapshots.mockResolvedValue( [
		{
			atomicSiteId: 123,
			localSiteId: siteId,
			userId: TEST_USER.id,
			url: 'draft.example.com',
			shareUrl: 'https://draft.example.com/?share=test',
			date: Date.now(),
		},
	] );
	const actions = userEvent.setup();
	await actions.click( await screen.findByRole( 'button', { name: /^Publish…$/ } ) );
	expect( await screen.findByRole( 'button', { name: remote.name } ) ).toBeVisible();
	expect( screen.getByRole( 'button', { name: 'Preview 1' } ) ).toBeVisible();
	expect( screen.queryByRole( 'combobox', { name: 'Who can view' } ) ).not.toBeInTheDocument();
	await actions.click( screen.getByRole( 'button', { name: remote.name } ) );
	expect( screen.getByRole( 'link', { name: 'Open published.example.com' } ) ).toBeVisible();
	expect( screen.getByRole( 'combobox', { name: 'Who can view' } ) ).toBeVisible();
	await waitFor( () => expect( screen.getByRole( 'button', { name: 'Update…' } ) ).toBeEnabled() );
	await actions.click( screen.getByRole( 'button', { name: 'Update…' } ) );
	const confirmation = await screen.findByRole( 'alertdialog', { name: 'Publish changes?' } );
	await actions.click( within( confirmation ).getByRole( 'button', { name: 'Publish changes' } ) );
	await waitFor( () =>
		expect( connector.pushSite ).toHaveBeenCalledExactlyOnceWith( 'wpcom', siteId, remote.id, {
			optionsToSync: [ 'all' ],
		} )
	);
	expect( screen.queryByRole( 'dialog', { name: 'Share and publish' } ) ).not.toBeInTheDocument();
	expect( connector.openExternalUrl ).not.toHaveBeenCalled();
	expect( connector.publishPreviewSite ).not.toHaveBeenCalled();
} );

it( 'keeps a connection created by pulling a preview out of the live destinations', async () => {
	const connector = setup();
	const localSiteId = connector.state.sites[ 0 ].id;
	connector.getSnapshots.mockResolvedValue( [
		{
			atomicSiteId: 123,
			localSiteId,
			userId: TEST_USER.id,
			url: 'preview.example.com',
			date: Date.now(),
		},
	] );
	connector.getRemoteSites.mockResolvedValue( [
		{
			id: 123,
			localSiteId,
			name: 'Preview',
			url: 'https://preview.example.com',
			isStaging: false,
			isPressable: false,
			syncSupport: 'needs-upgrade',
			lastPullTimestamp: null,
			lastPushTimestamp: null,
		},
	] );
	const actions = userEvent.setup();
	await actions.click( await screen.findByRole( 'button', { name: /^Publish…$/ } ) );
	expect( await screen.findByRole( 'group', { name: /^Preview: / } ) ).toBeVisible();
	expect( screen.queryByRole( 'button', { name: 'Choose destination' } ) ).not.toBeInTheDocument();
	expect( screen.getByRole( 'button', { name: 'Update…' } ) ).toBeVisible();
	expect( screen.getByRole( 'link', { name: /^Open preview:/ } ) ).toBeVisible();
} );

it.each( [ false, true ] )(
	'resets after deleting a pulled preview, keeping a live connection when present (%s)',
	async ( hasLiveSite ) => {
		const connector = setup();
		const localSiteId = connector.state.sites[ 0 ].id;
		const snapshot: Snapshot = {
			atomicSiteId: 123,
			localSiteId,
			userId: TEST_USER.id,
			url: 'delete.example.com',
			date: Date.now(),
		};
		const connection = {
			id: 123,
			localSiteId,
			name: 'Preview',
			url: 'https://delete.example.com',
			isStaging: false,
			isPressable: false,
			syncSupport: 'needs-upgrade' as const,
			lastPullTimestamp: null,
			lastPushTimestamp: null,
		};
		const live = {
			...connection,
			id: 456,
			name: 'Live',
			url: 'https://live.example.com',
			syncSupport: 'syncable' as const,
			lastPushTimestamp: new Date().toISOString(),
		};
		connector.getSnapshots.mockResolvedValue( [ snapshot ] );
		connector.getRemoteSites.mockResolvedValue(
			hasLiveSite ? [ connection, live ] : [ connection ]
		);
		connector.listAccountSites.mockResolvedValue(
			hasLiveSite ? [ connection, live ] : [ connection ]
		);
		connector.deleteSnapshot.mockImplementation( async () => {
			connector.getSnapshots.mockResolvedValue( [] );
			connector.getRemoteSites.mockResolvedValue( hasLiveSite ? [ live ] : [] );
		} );
		const actions = userEvent.setup();
		await actions.click( await screen.findByRole( 'button', { name: /^Publish…$/ } ) );
		await openPreviewMenu( actions, 'Preview 1' );
		await actions.click( screen.getByRole( 'menuitem', { name: 'Delete preview…' } ) );
		await actions.click( await screen.findByRole( 'button', { name: 'Delete preview' } ) );
		await waitFor( () => expect( screen.queryByRole( 'alertdialog' ) ).not.toBeInTheDocument() );
		expect( screen.queryByRole( 'dialog', { name: publishPanelName } ) ).not.toBeInTheDocument();
		expect( connector.publishPreviewSite ).not.toHaveBeenCalled();
		const trigger = screen.getByRole( 'button', { name: /^Publish…$/ } );
		expect( trigger ).toHaveFocus();
		expect( screen.queryByText( 'Expires on', { selector: 'span' } ) ).not.toBeInTheDocument();
		await actions.click( trigger );
		if ( hasLiveSite ) {
			expect( screen.queryByRole( 'button', { name: 'Add a domain' } ) ).not.toBeInTheDocument();
			expect( await screen.findByRole( 'button', { name: 'Update…' } ) ).toBeEnabled();
			expect( connector.publishPreviewSite ).not.toHaveBeenCalled();
		} else {
			expect( connector.publishPreviewSite ).not.toHaveBeenCalled();
			await actions.click( await screen.findByRole( 'button', { name: 'Create preview' } ) );
			await waitFor( () =>
				expect( connector.publishPreviewSite ).toHaveBeenCalledExactlyOnceWith(
					localSiteId,
					undefined,
					undefined
				)
			);
		}
	}
);

it( 'keeps local changes usable and confirms replacement when remote changes are unknown', async () => {
	const connector = setup( {
		listAccountSites: async () => [ pullablePreview( 123 ) ],
		getPreviewStatus: async () => ( {
			localSiteId: 'local',
			localChanged: true,
			previewChanged: null,
		} ),
	} );
	connector.getSnapshots.mockResolvedValue( [
		{
			atomicSiteId: 123,
			localSiteId: connector.state.sites[ 0 ].id,
			userId: TEST_USER.id,
			url: 'unknown.example.com',
			date: Date.now(),
		},
	] );
	const actions = userEvent.setup();
	await actions.click( await screen.findByRole( 'button', { name: /^Publish…$/ } ) );
	expect( await screen.findByRole( 'button', { name: 'Pull from preview…' } ) ).toBeVisible();
	expect( screen.queryByText( /couldn’t compare the local site/i ) ).not.toBeInTheDocument();
	expect( getVisibleToasts().filter( ( item ) => item.intent === 'error' ) ).toHaveLength( 0 );
	await actions.click( screen.getByRole( 'button', { name: 'Update…' } ) );
	expect( await screen.findByText( 'Replace preview contents?' ) ).toBeVisible();
	expect( screen.getByRole( 'alertdialog' ) ).toHaveAccessibleDescription(
		'Studio can’t tell whether anyone edited unknown.example.com. Updating the preview will replace it with your local site.'
	);
	expect( connector.publishPreviewSite ).not.toHaveBeenCalled();
	await actions.click( screen.getByRole( 'button', { name: 'Cancel' } ) );
	expect( connector.publishPreviewSite ).not.toHaveBeenCalled();
} );

it.each( [
	[ 'preview', undefined, 'Publishing…' ],
	[ 'preview', 'preview.example.com', 'Publishing…' ],
	[ 'push', undefined, 'Publishing…' ],
	[ 'pull', undefined, 'Pulling…' ],
] as const )(
	'keeps the Publish label while reporting %s progress',
	async ( direction, hostname, description ) => {
		const connector = setup();
		const button = await screen.findByRole( 'button', { name: /^Publish…$/ } );
		expect( button.querySelector( 'svg' ) ).not.toBeInTheDocument();
		await act( () =>
			applySyncActivity( connector.state.sites[ 0 ].id, { kind: 'pending', direction, hostname } )
		);
		expect( button ).toHaveAccessibleName( 'Publish…' );
		expect( button ).toHaveTextContent( /^Publish$/ );
		expect( button ).toHaveAccessibleDescription( description );
		expect( button.querySelector( '[data-slot="spinner"]' ) ).toBeInTheDocument();
		await act( () =>
			applySyncActivity( connector.state.sites[ 0 ].id, { kind: 'success', direction } )
		);
		expect( button ).toHaveAccessibleName( 'Publish…' );
		expect( button ).toHaveTextContent( /^Publish$/ );
		expect( button.querySelector( '[data-slot="spinner"]' ) ).not.toBeInTheDocument();
		expect( button.querySelector( 'svg' ) ).not.toBeInTheDocument();
	}
);

it( 'keeps preview access factual before and after an explicit launch handoff', async () => {
	const connector = setup( {
		getPreviewStatus: async () => ( {
			localSiteId: null,
			localChanged: false,
			previewChanged: false,
		} ),
	} );
	connector.getSnapshots.mockResolvedValue( [
		{
			atomicSiteId: 123,
			localSiteId: connector.state.sites[ 0 ].id,
			userId: TEST_USER.id,
			date: Date.now(),
			url: 'domain.example.com',
			launchUrl: 'https://wordpress.com/setup/launch-site?siteId=123',
		},
	] );
	const actions = userEvent.setup();
	await actions.click( await screen.findByRole( 'button', { name: /^Publish…$/ } ) );
	expect( await screen.findByRole( 'button', { name: 'Expires' } ) ).toBeVisible();
	expect( screen.getByRole( 'combobox', { name: 'Who can view' } ) ).toHaveAccessibleDescription(
		'Anyone with the link'
	);
	await choosePreviewAccess( actions, 'Everyone' );
	expect( connector.openExternalUrl ).not.toHaveBeenCalled();
	await choosePreviewAccess( actions, 'Anyone with the link' );
	let finish!: () => void;
	connector.openExternalUrl.mockImplementationOnce(
		() =>
			new Promise< void >( ( resolve ) => {
				finish = resolve;
			} )
	);
	const launch = screen.getByRole( 'button', { name: 'Launch on WordPress.com' } );
	await actions.click( launch );
	expect( launch ).toHaveAttribute( 'aria-busy', 'true' );
	expect( connector.trackEvent ).toHaveBeenCalledWith( TRACKS_EVENTS.SYNC_PUBLISH_SITE, {
		entry_point: 'launch',
	} );
	await waitFor( () =>
		expect( connector.openExternalUrl ).toHaveBeenCalledExactlyOnceWith(
			'https://wordpress.com/setup/launch-site?siteId=123'
		)
	);
	expect( connector.watchForPublishedSite ).not.toHaveBeenCalled();
	expect( connector.publishPreviewSite ).not.toHaveBeenCalled();
	expect( connector.setSiteVisibility ).not.toHaveBeenCalled();
	await act( async () => finish() );
	expect( screen.getByRole( 'combobox', { name: 'Who can view' } ) ).toHaveAccessibleDescription(
		'Anyone with the link'
	);
	expect( screen.getByRole( 'button', { name: 'Update' } ) ).toBeVisible();
} );

it.each( [ false, true ] )(
	'offers the new site for its first publish after checkout (panel closed: %s)',
	async ( closed ) => {
		const previewId = 123;
		const remote = {
			id: 789,
			localSiteId: '',
			name: 'My public site',
			url: 'https://new-site.blog',
			launchStatus: 'unlaunched',
			isStaging: false,
			isPressable: false,
			syncSupport: 'syncable' as const,
			pushNeedsUpgrade: false,
			lastPushTimestamp: null,
			lastPullTimestamp: null,
		};
		const otherSite = { ...remote, id: 456, url: 'https://unrelated.blog' };
		const connector = setup( {
			listAccountSites: async () => [ otherSite ],
			getRemoteSites: async () => [],
			getPreviewStatus: async () => ( {
				localSiteId: null,
				localChanged: false,
				previewChanged: false,
			} ),
		} );
		const studioSiteId = connector.state.sites[ 0 ].id;
		connector.getSnapshots.mockResolvedValue( [
			{
				atomicSiteId: previewId,
				localSiteId: studioSiteId,
				userId: TEST_USER.id,
				date: Date.now(),
				url: 'existing.wpcomstaging.com',
			},
		] );
		connector.connectRemoteSite.mockImplementation( async ( _provider, _siteId, site ) => {
			connector.getRemoteSites.mockResolvedValue( [
				{ ...remote, ...site, localSiteId: studioSiteId },
			] );
		} );
		const actions = userEvent.setup();
		await actions.click( await screen.findByRole( 'button', { name: 'Publish…' } ) );
		await actions.click( await screen.findByRole( 'button', { name: 'Publish somewhere else' } ) );
		await choosePreviewAccess( actions, 'Everyone' );
		await actions.click( screen.getByRole( 'button', { name: 'Continue on WordPress.com' } ) );
		await waitFor( () => expect( connector.openExternalUrl ).toHaveBeenCalledTimes( 1 ) );
		expect( connector.connectRemoteSite ).not.toHaveBeenCalled();
		if ( closed ) await actions.keyboard( '{Escape}{Escape}' );

		connector.listAccountSites.mockResolvedValue( [ otherSite, remote ] );
		act( () =>
			connector.emit( 'onSyncConnectSite', {
				studioSiteId,
				remoteSiteId: remote.id,
				autoOpenPush: true,
			} )
		);
		await waitFor( () => {
			expect( getVisibleToasts() ).toContainEqual(
				expect.objectContaining( {
					title: 'Your site is ready to publish',
					description: remote.name,
				} )
			);
		} );
		expect( connector.connectRemoteSite ).toHaveBeenCalledExactlyOnceWith(
			'wpcom',
			studioSiteId,
			expect.objectContaining( { id: remote.id, launchAfterPush: true } )
		);
		if ( closed ) expect( screen.queryByRole( 'dialog' ) ).not.toBeInTheDocument();
		else {
			expect( screen.getByRole( 'dialog', { name: 'Publish somewhere else' } ) ).toBeVisible();
			await actions.keyboard( '{Escape}{Escape}' );
		}
		await actions.click( screen.getByRole( 'button', { name: 'Publish…' } ) );
		await actions.click( await screen.findByRole( 'button', { name: remote.name } ) );
		expect( screen.getByRole( 'link', { name: 'Open new-site.blog' } ) ).toBeVisible();
		expect( await screen.findByRole( 'button', { name: 'Update' } ) ).toBeVisible();
		expect(
			screen.queryByRole( 'button', { name: 'Reopen WordPress.com' } )
		).not.toBeInTheDocument();
		expect( screen.queryByRole( 'button', { name: 'What to publish' } ) ).not.toBeInTheDocument();
		expect( connector.pushSite ).not.toHaveBeenCalled();
		expect( connector.publishPreviewSite ).not.toHaveBeenCalled();
		expect( connector.deleteSnapshot ).not.toHaveBeenCalled();
		await actions.click( screen.getByRole( 'button', { name: 'Update' } ) );
		await waitFor( () =>
			expect( connector.pushSite ).toHaveBeenCalledExactlyOnceWith(
				'wpcom',
				studioSiteId,
				remote.id,
				{ optionsToSync: [ 'all' ] }
			)
		);
	}
);

it( 'opens WordPress.com checkout from launch without creating a preview', async () => {
	const connector = setup();
	const actions = userEvent.setup();
	await actions.click( await screen.findByRole( 'button', { name: 'Publish…' } ) );
	const panel = await screen.findByRole( 'dialog', { name: publishPanelName } );
	const footer = within( panel ).getByRole( 'group', { name: 'Preview actions' } );
	const launch = within( footer ).getByRole( 'button', { name: 'Launch on WordPress.com' } );
	expect( launch ).toHaveAttribute( 'data-variant', 'outline' );
	expect(
		within( footer )
			.getAllByRole( 'button' )
			.map( ( button ) => button.textContent )
	).toEqual( [ 'Launch on WordPress.com', 'Create preview' ] );
	expect( within( footer ).getByRole( 'button', { name: 'Create preview' } ) ).toHaveAttribute(
		'data-variant',
		'accent'
	);
	await actions.click( launch );
	expect( connector.trackEvent ).toHaveBeenCalledWith( TRACKS_EVENTS.SYNC_PUBLISH_SITE, {
		entry_point: 'launch',
	} );
	expect( connector.openExternalUrl ).toHaveBeenCalledExactlyOnceWith(
		buildPublishCheckoutUrl( connector.state.sites[ 0 ] )
	);
	expect( connector.publishPreviewSite ).not.toHaveBeenCalled();
} );

it( 'opens checkout at the preview limit without creating a preview', async () => {
	const connector = setup( {
		getSnapshotUsage: async () => ( { siteCount: 5, siteLimit: 5, siteCreationBlocked: false } ),
	} );
	const actions = userEvent.setup();
	await actions.click( await screen.findByRole( 'button', { name: 'Publish…' } ) );
	expect( screen.getByRole( 'combobox', { name: 'Who can view' } ) ).toHaveAccessibleDescription(
		'Anyone with the link'
	);
	expect( screen.getByRole( 'button', { name: 'Create preview' } ) ).toBeVisible();
	await choosePreviewAccess( actions, 'Everyone' );
	expect( connector.openExternalUrl ).not.toHaveBeenCalled();
	expect( screen.queryByRole( 'button', { name: 'Create preview' } ) ).not.toBeInTheDocument();
	expect(
		screen.queryByRole( 'button', { name: 'Launch on WordPress.com' } )
	).not.toBeInTheDocument();
	const checkout = screen.getByRole( 'button', { name: 'Continue on WordPress.com' } );
	expect( checkout ).toHaveAttribute( 'data-variant', 'accent' );
	await actions.click( checkout );
	expect( connector.trackEvent ).toHaveBeenCalledWith( TRACKS_EVENTS.SYNC_PUBLISH_SITE, {
		entry_point: 'publish',
	} );
	await waitFor( () =>
		expect( screen.getByRole( 'button', { name: 'Continue on WordPress.com' } ) ).toBeEnabled()
	);
	expect( connector.openExternalUrl ).toHaveBeenCalledExactlyOnceWith(
		buildPublishCheckoutUrl( connector.state.sites[ 0 ] )
	);
	expect( connector.watchForPublishedSite ).toHaveBeenCalledExactlyOnceWith(
		connector.state.sites[ 0 ].id
	);
	expect( connector.publishPreviewSite ).not.toHaveBeenCalled();
	expect( connector.pushSite ).not.toHaveBeenCalled();
} );

it( 'can retry opening WordPress.com after the browser handoff fails', async () => {
	const connector = setup();
	connector.openExternalUrl.mockRejectedValueOnce( new Error( 'Could not open the browser.' ) );
	const actions = userEvent.setup();
	await actions.click( await screen.findByRole( 'button', { name: 'Publish…' } ) );
	await choosePreviewAccess( actions, 'Everyone' );
	const button = screen.getByRole( 'button', { name: 'Continue on WordPress.com' } );
	await actions.click( button );
	expect( await screen.findByRole( 'alert' ) ).toHaveTextContent( 'Could not open the browser.' );
	expect( button ).toBeEnabled();
	await actions.click( button );
	await waitFor( () => expect( connector.openExternalUrl ).toHaveBeenCalledTimes( 2 ) );
	expect( screen.queryByRole( 'alert' ) ).not.toBeInTheDocument();
	expect( connector.publishPreviewSite ).not.toHaveBeenCalled();
} );

it( 'keeps checklist choices live in the confirmation and publishes the selection', async () => {
	const remote = {
		id: 42,
		localSiteId: 'local',
		name: 'Hosted site',
		url: 'https://example.com',
		isStaging: false,
		isPressable: false,
		syncSupport: 'syncable' as const,
		lastPushTimestamp: new Date().toISOString(),
		lastPullTimestamp: null,
	};
	const connector = setup( {
		getRemoteSites: async () => [ remote ],
		listAccountSites: async () => [ remote ],
		getSiteVisibility: async () => ( {
			visibility: 'public',
			launchStatus: 'launched',
			url: remote.url,
		} ),
		listLocalFileTree: async () => [
			{ name: 'themes', path: 'wp-content/themes', isDirectory: true },
			{ name: 'plugins', path: 'wp-content/plugins', isDirectory: true },
			{ name: 'uploads', path: 'wp-content/uploads', isDirectory: true },
			{ name: 'index.php', path: 'wp-content/index.php', isDirectory: false },
		],
	} );
	const actions = userEvent.setup();
	await actions.click( await screen.findByRole( 'button', { name: /^Publish…$/ } ) );
	expect( screen.queryByRole( 'button', { name: 'What to publish' } ) ).not.toBeInTheDocument();
	await actions.click( await screen.findByRole( 'button', { name: 'Update…' } ) );
	const confirmation = await screen.findByRole( 'alertdialog', { name: 'Publish changes?' } );
	await actions.click( within( confirmation ).getByRole( 'button', { name: 'What to publish' } ) );
	expect( await screen.findByRole( 'checkbox', { name: 'Themes' } ) ).toBeChecked();
	expect( screen.getAllByRole( 'checkbox' ) ).toHaveLength( 5 );
	expect(
		within( confirmation ).getByRole( 'heading', { name: 'Publish changes?' } )
	).toBeVisible();
	await actions.click( screen.getByRole( 'checkbox', { name: /Database/ } ) );
	expect( screen.getByRole( 'button', { name: 'What to publish' } ) ).toHaveAccessibleDescription(
		'Files only'
	);
	const everything = screen.getByRole( 'checkbox', { name: 'Everything' } );
	expect( everything ).toBePartiallyChecked();
	expect( everything.querySelector( '.lucide-minus' ) ).toBeInTheDocument();
	await actions.click( everything );
	for ( const checkbox of screen.getAllByRole( 'checkbox' ) ) expect( checkbox ).toBeChecked();
	expect( everything ).toHaveAttribute( 'aria-disabled', 'true' );
	await actions.click( screen.getByRole( 'checkbox', { name: 'Uploads' } ) );
	expect( screen.getByRole( 'button', { name: 'What to publish' } ) ).toHaveAccessibleDescription(
		'All but uploads'
	);
	await actions.click( screen.getByRole( 'checkbox', { name: 'Plugins' } ) );
	await actions.click( screen.getByRole( 'checkbox', { name: /Database/ } ) );
	const themes = screen.getByRole( 'checkbox', { name: 'Themes' } );
	expect( themes ).toBeChecked();
	expect( themes ).toHaveAttribute( 'aria-disabled', 'true' );
	await actions.click( themes );
	expect( themes ).toBeChecked();
	await actions.click( screen.getByRole( 'checkbox', { name: 'Plugins' } ) );
	expect( themes ).not.toHaveAttribute( 'aria-disabled', 'true' );
	await actions.click( screen.getByRole( 'checkbox', { name: 'Plugins' } ) );
	await actions.keyboard( '{Escape}' );
	expect( screen.queryByRole( 'checkbox' ) ).not.toBeInTheDocument();
	expect( screen.getByRole( 'button', { name: 'What to publish' } ) ).toHaveAccessibleDescription(
		'Themes'
	);
	await actions.click( screen.getByRole( 'button', { name: 'What to publish' } ) );
	await actions.click( await screen.findByRole( 'checkbox', { name: 'Plugins' } ) );
	expect( screen.getByRole( 'button', { name: 'What to publish' } ) ).toHaveAccessibleDescription(
		'Plugins and themes'
	);
	await actions.keyboard( '{Escape}' );
	expect( screen.queryByRole( 'checkbox' ) ).not.toBeInTheDocument();
	expect(
		within( confirmation ).getByRole( 'heading', { name: 'Publish changes?' } )
	).toBeVisible();
	expect( screen.getByRole( 'button', { name: 'What to publish' } ) ).toHaveFocus();
	const publish = within( confirmation ).getByRole( 'button', { name: 'Publish changes' } );
	await waitFor( () => expect( publish ).toBeEnabled() );
	await actions.click( publish );
	await waitFor( () =>
		expect( connector.pushSite ).toHaveBeenCalledWith( 'wpcom', connector.state.sites[ 0 ].id, 42, {
			optionsToSync: [ 'plugins', 'themes' ],
			specificSelectionPaths: [ 'plugins', 'themes' ],
		} )
	);
} );

it( 'opens and copies a preview from its preview row', async () => {
	let finishCopy!: () => void;
	const connector = setup( {
		listAccountSites: async () => [ pullablePreview( 123 ) ],
		copyText: () =>
			new Promise< void >( ( resolve ) => {
				finishCopy = resolve;
			} ),
	} );
	connector.getSnapshots.mockResolvedValue( [
		{
			atomicSiteId: 123,
			localSiteId: connector.state.sites[ 0 ].id,
			userId: TEST_USER.id,
			date: Date.now(),
			url: 'copy.example.com',
			shareUrl: 'https://copy.example.com/?share=test',
		},
	] );
	connector.getPreviewStatus.mockResolvedValue( {
		localSiteId: connector.state.sites[ 0 ].id,
		localChanged: false,
		previewChanged: false,
	} );
	const actions = userEvent.setup();
	await actions.click( await screen.findByRole( 'button', { name: /^Publish…$/ } ) );
	const panel = await screen.findByRole( 'dialog', { name: publishPanelName } );
	expect(
		within( panel ).queryByRole( 'heading', { name: /^(Details|Suggested)$/ } )
	).not.toBeInTheDocument();
	expect(
		within( panel ).queryByText( 'Share your WordPress', { selector: 'h3' } )
	).not.toBeInTheDocument();
	expect( within( panel ).getByRole( 'button', { name: 'Expires' } ) ).toBeVisible();
	expect( within( panel ).queryByText( /^Last updated/ ) ).not.toBeInTheDocument();
	const row = screen.getByRole( 'group', { name: 'Preview: Preview 1' } );
	await copyPreviewLink( actions );
	await act( async () => finishCopy() );
	expect( getVisibleToasts().some( ( notice ) => notice.title === 'Link copied' ) ).toBe( true );
	expect( connector.copyText ).toHaveBeenCalledWith( 'https://copy.example.com/?share=test' );
	expect( connector.openExternalUrl ).not.toHaveBeenCalled();
	const openPreview = within( row ).getByRole( 'link', { name: /^Open preview:/ } );
	fireEvent.contextMenu( openPreview );
	expect( screen.queryByRole( 'menu', { name: 'Preview 1' } ) ).not.toBeInTheDocument();
	const previewActions = screen.getByRole( 'button', { name: 'Preview actions' } );
	previewActions.focus();
	await actions.keyboard( '{Enter}' );
	const menu = await screen.findByRole( 'menu', { name: 'Preview 1' } );
	expect( within( menu ).queryByRole( 'menuitem', { name: 'Rename' } ) ).not.toBeInTheDocument();
	expect( within( menu ).getByRole( 'menuitem', { name: 'Pull from preview…' } ) ).toBeVisible();
	await actions.keyboard( '{Escape}' );
	await waitFor( () => expect( previewActions ).toHaveFocus() );
	openPreview.focus();
	await actions.keyboard( '{Enter}' );
	expect( connector.openExternalUrl ).toHaveBeenCalledExactlyOnceWith(
		'https://copy.example.com/?share=test'
	);
	expect( getVisibleToasts().find( ( item ) => item.id === 'clipboard-success' ) ).toMatchObject( {
		title: 'Link copied',
	} );

	expect( screen.queryByRole( 'button', { name: 'Copy preview link' } ) ).not.toBeInTheDocument();
} );

it( 'shows destination controls for an unpublished site', async () => {
	const connector = setup();
	const actions = userEvent.setup();
	await actions.click( await screen.findByRole( 'button', { name: 'Publish…' } ) );
	const panel = await screen.findByRole( 'dialog', { name: publishPanelName } );
	expect( within( panel ).getByText( 'Destination', { exact: true } ) ).toBeVisible();
	expect( within( panel ).queryByRole( 'button', { name: 'Expires' } ) ).not.toBeInTheDocument();
	expect( connector.publishPreviewSite ).not.toHaveBeenCalled();
} );

it( 'checks access while refreshing stored visibility', async () => {
	const connector = setup();
	connector.getSiteVisibility.mockImplementation( () => new Promise( () => {} ) );
	connector.getRemoteSites.mockResolvedValue( [
		{
			...pullablePreview( 42 ),
			localSiteId: connector.state.sites[ 0 ].id,
			name: 'Remote site',
			url: 'https://published.example.com',
			launchStatus: 'launched',
			visibility: 'private' as const,
		},
	] );
	const actions = userEvent.setup();
	await actions.click( await screen.findByRole( 'button', { name: 'Publish…' } ) );
	expect(
		await screen.findByRole( 'combobox', { name: 'Who can view' } )
	).toHaveAccessibleDescription( 'Checking access…' );
} );

it( 'updates an up-to-date preview from the primary button and copies its link from the menu', async () => {
	const connector = setup( {
		getPreviewStatus: async () => ( {
			localSiteId: null,
			localChanged: false,
			previewChanged: false,
		} ),
	} );
	connector.getSnapshots.mockResolvedValue( [
		{
			atomicSiteId: 123,
			localSiteId: connector.state.sites[ 0 ].id,
			userId: TEST_USER.id,
			date: Date.now(),
			url: 'footer.example.com',
		},
	] );
	const actions = userEvent.setup();
	await actions.click( await screen.findByRole( 'button', { name: /^Publish…$/ } ) );
	expect( await screen.findByRole( 'group', { name: /^Preview: / } ) ).toBeVisible();
	await actions.hover( screen.getByRole( 'button', { name: 'Expires' } ) );
	const expiration = await screen.findByRole( 'dialog', { name: 'Preview expiration' } );
	expect(
		within( expiration ).getByText(
			/Preview sites are temporary\. Updating your preview resets the expiration date\./
		)
	).toBeVisible();
	await actions.click( screen.getByRole( 'button', { name: 'Expires' } ) );
	await actions.click( within( expiration ).getByRole( 'button', { name: 'Learn more' } ) );
	expect( connector.openExternalUrl ).toHaveBeenCalledWith(
		'https://wordpress.studio/docs/preview-sites/#preview-expiration'
	);
	await actions.keyboard( '{Escape}' );
	expect( screen.getByRole( 'button', { name: 'Expires' } ) ).toHaveFocus();
	const update = await screen.findByRole( 'button', { name: 'Update' } );
	expect( update ).toHaveAttribute( 'data-variant', 'accent' );
	expect( screen.queryByRole( 'button', { name: 'Copy link' } ) ).not.toBeInTheDocument();
	await actions.click( screen.getByRole( 'button', { name: 'Preview actions' } ) );
	const menu = await screen.findByRole( 'menu' );
	expect(
		within( menu ).queryByRole( 'menuitem', { name: /^Update…?$/ } )
	).not.toBeInTheDocument();
	await actions.click( within( menu ).getByRole( 'menuitem', { name: 'Copy link' } ) );
	expect( connector.copyText ).toHaveBeenCalledWith( 'https://footer.example.com' );
	expect( connector.publishPreviewSite ).not.toHaveBeenCalled();
	await actions.click( update );
	await waitFor( () =>
		expect( connector.publishPreviewSite ).toHaveBeenCalledExactlyOnceWith(
			connector.state.sites[ 0 ].id,
			'footer.example.com',
			undefined
		)
	);
} );

it( 'keeps the preview update action and acknowledges the changes dot', async () => {
	let changed = true;
	let finish!: () => void;
	const connector = setup( {
		getPreviewStatus: async () => ( {
			localSiteId: null,
			localChanged: changed,
			previewChanged: false,
		} ),
		publishPreviewSite: async () => {
			await new Promise< void >( ( resolve ) => {
				finish = resolve;
			} );
			changed = false;
			return { url: 'https://inline.example.com' };
		},
	} );
	connector.getSnapshots.mockResolvedValue( [
		{
			atomicSiteId: 123,
			localSiteId: connector.state.sites[ 0 ].id,
			userId: TEST_USER.id,
			date: Date.now(),
			url: 'inline.example.com',
		},
	] );
	const actions = userEvent.setup();
	const share = await screen.findByRole( 'button', { name: /^Publish…$/ } );
	await waitFor( () => expect( share.querySelector( '[data-pulse]' ) ).toBeInTheDocument() );
	await actions.click( share );
	expect( screen.getByRole( 'group', { name: /^Preview: / } ) ).toBeVisible();
	expect( screen.queryByRole( 'status', { name: 'Publishing status' } ) ).not.toBeInTheDocument();
	expect( screen.queryByText( 'Local changes to share' ) ).not.toBeInTheDocument();
	expect(
		screen.getByRole( 'button', {
			name: 'Update',
		} )
	).toBeVisible();
	expect( screen.queryByRole( 'button', { name: 'Copy preview link' } ) ).not.toBeInTheDocument();
	expect( screen.queryByRole( 'button', { name: 'What to publish' } ) ).not.toBeInTheDocument();
	expect( share.querySelector( '[data-pulse]' ) ).not.toBeInTheDocument();
	await actions.click( screen.getByRole( 'button', { name: 'Update' } ) );
	expect( await screen.findByRole( 'button', { name: 'Updating…' } ) ).toHaveAttribute(
		'aria-busy',
		'true'
	);
	expect( screen.getByRole( 'group', { name: /^Preview: / } ) ).toBeVisible();
	await waitFor( () => expect( connector.publishPreviewSite ).toHaveBeenCalledTimes( 1 ) );
	await act( async () => finish() );
	expect( await screen.findByRole( 'group', { name: /^Preview: / } ) ).toBeVisible();
	expect( await screen.findByRole( 'button', { name: 'Update' } ) ).not.toHaveAttribute(
		'aria-busy',
		'true'
	);
	await actions.click( share );
	expect( share.querySelector( '[data-pulse]' ) ).not.toBeInTheDocument();
} );

it( 'refreshes the primary address and launch state after checkout without publishing', async () => {
	const remote = {
		id: 42,
		localSiteId: 'local',
		name: 'Lente Starter',
		url: 'https://lentestarter.wpcomstaging.com',
		isStaging: false,
		isPressable: false,
		syncSupport: 'syncable' as const,
		lastPushTimestamp: null,
		lastPullTimestamp: null,
	};
	const connector = setup( {
		getRemoteSites: async () => [ remote ],
		listAccountSites: async () => [
			{ ...remote, url: 'https://lentestarter.blog', launchStatus: 'unlaunched' },
		],
	} );
	connector.getSiteVisibility.mockResolvedValue( {
		visibility: 'coming-soon',
		url: 'https://lentestarter.blog',
		launchStatus: 'unlaunched',
	} );
	const actions = userEvent.setup();
	await actions.click( await screen.findByRole( 'button', { name: /^Publish…$/ } ) );
	expect( await screen.findByText( 'lentestarter.blog', { exact: true } ) ).toBeVisible();
	expect( screen.getByRole( 'combobox', { name: 'Who can view' } ) ).toHaveTextContent(
		'Only you'
	);
	expect( screen.queryByRole( 'button', { name: 'Copy preview link' } ) ).not.toBeInTheDocument();
	await actions.keyboard( '{Escape}' );
	await waitFor( () =>
		expect( screen.queryByRole( 'dialog', { name: publishPanelName } ) ).not.toBeInTheDocument()
	);
	connector.getSiteVisibility.mockResolvedValue( {
		visibility: 'public',
		url: 'https://new-address.blog',
		launchStatus: 'launched',
	} );
	connector.listAccountSites.mockResolvedValue( [
		{ ...remote, url: 'https://new-address.blog', launchStatus: 'launched' },
	] );
	await actions.click( screen.getByRole( 'button', { name: /^Publish…$/ } ) );
	expect( await screen.findByText( 'new-address.blog', { exact: true } ) ).toBeVisible();
	expect( screen.getByRole( 'combobox', { name: 'Who can view' } ) ).toHaveTextContent(
		'Everyone'
	);
	expect( connector.pushSite ).not.toHaveBeenCalled();
	expect( connector.publishPreviewSite ).not.toHaveBeenCalled();
	expect( connector.openExternalUrl ).not.toHaveBeenCalled();
	await actions.click( screen.getByRole( 'link', { name: 'Open new-address.blog' } ) );
	await waitFor( () =>
		expect( connector.openExternalUrl ).toHaveBeenCalledWith( 'https://new-address.blog' )
	);
	expect( screen.queryByRole( 'button', { name: 'Manage domain' } ) ).not.toBeInTheDocument();
	expect( screen.queryByRole( 'button', { name: 'Add a domain' } ) ).not.toBeInTheDocument();
	expect( screen.getByRole( 'combobox', { name: 'Who can view' } ) ).toHaveAttribute(
		'aria-description',
		'Everyone'
	);
	await actions.click( screen.getByRole( 'combobox', { name: 'Who can view' } ) );
	expect( await screen.findByRole( 'option', { name: 'Everyone', selected: true } ) ).toBeVisible();
	expect( connector.setSiteVisibility ).not.toHaveBeenCalled();
} );

function setupHostedVisibility( initial: 'public' | 'coming-soon' = 'public', failSave = false ) {
	const remote = {
		id: 42,
		localSiteId: 'local',
		name: 'Hosted site',
		url: 'https://hosted.blog',
		isStaging: false,
		isPressable: false,
		syncSupport: 'syncable' as const,
		lastPushTimestamp: null,
		lastPullTimestamp: null,
	};
	let visibility = initial;
	const connector = setup( {
		getRemoteSites: async () => [ remote ],
		listAccountSites: async () => [ remote ],
		getSiteVisibility: async () => ( {
			visibility,
			url: remote.url,
			launchStatus: 'launched',
		} ),
		setSiteVisibility: async ( _provider, _id, next ) => {
			if ( failSave ) throw new Error( 'Could not save visibility' );
			if ( next === 'private' ) throw new Error( 'Unexpected private visibility' );
			visibility = next;
			return { visibility, url: remote.url, launchStatus: 'launched' };
		},
	} );
	return connector;
}

it.each( [ 'public', 'coming-soon' ] as const )(
	'saves hosted visibility from %s in the anchored picker',
	async ( initial ) => {
		const connector = setupHostedVisibility( initial );
		const actions = userEvent.setup();
		await actions.click( await screen.findByRole( 'button', { name: /^Publish…$/ } ) );
		await actions.click( await screen.findByRole( 'combobox', { name: 'Who can view' } ) );
		const next = initial === 'public' ? 'coming-soon' : 'public';
		await actions.click(
			await screen.findByRole( 'option', {
				name: next === 'public' ? 'Everyone' : 'Only you',
			} )
		);
		await waitFor( () =>
			expect( connector.setSiteVisibility ).toHaveBeenCalledExactlyOnceWith( 'wpcom', 42, next )
		);
		await waitFor( () => expect( screen.queryByRole( 'listbox' ) ).not.toBeInTheDocument() );
		expect( screen.getByRole( 'combobox', { name: 'Who can view' } ) ).toHaveAccessibleDescription(
			next === 'public' ? 'Everyone' : 'Only you'
		);
		expect( connector.openExternalUrl ).not.toHaveBeenCalled();
		expect( connector.pushSite ).not.toHaveBeenCalled();
	}
);

it( 'closes the hosted picker with Escape without changing visibility or closing Publish', async () => {
	const connector = setupHostedVisibility();
	const actions = userEvent.setup();
	await actions.click( await screen.findByRole( 'button', { name: 'Publish…' } ) );
	await actions.click( screen.getByRole( 'combobox', { name: 'Who can view' } ) );
	await screen.findByRole( 'option', { name: 'Only you' } );
	await actions.keyboard( '{Escape}' );
	expect( screen.queryByRole( 'listbox' ) ).not.toBeInTheDocument();
	expect( connector.setSiteVisibility ).not.toHaveBeenCalled();
} );

it( 'keeps the current visibility checked after a failed save and permits retry', async () => {
	const connector = setupHostedVisibility( 'public', true );
	const actions = userEvent.setup();
	await actions.click( await screen.findByRole( 'button', { name: 'Publish…' } ) );
	await actions.click( screen.getByRole( 'combobox', { name: 'Who can view' } ) );
	await actions.click( await screen.findByRole( 'option', { name: 'Only you' } ) );
	expect( await screen.findByRole( 'alert' ) ).toHaveTextContent( 'Could not save visibility' );
	expect( screen.getByRole( 'option', { name: 'Everyone', selected: true } ) ).toBeVisible();
	expect( screen.getByRole( 'option', { name: 'Only you', selected: false } ) ).toBeVisible();
	connector.setSiteVisibility.mockResolvedValue( {
		visibility: 'coming-soon',
		url: 'https://hosted.blog',
		launchStatus: 'launched',
	} );
	await actions.click( screen.getByRole( 'option', { name: 'Only you' } ) );
	await waitFor( () => expect( screen.queryByRole( 'listbox' ) ).not.toBeInTheDocument() );
	expect( screen.getByRole( 'combobox', { name: 'Who can view' } ) ).toHaveAccessibleDescription(
		'Only you'
	);
} );

it( 'shows people-based visibility options with descriptions and the current checkmark', async () => {
	const connector = setupHostedVisibility();
	const actions = userEvent.setup();
	await actions.click( await screen.findByRole( 'button', { name: 'Publish…' } ) );
	await actions.click( screen.getByRole( 'combobox', { name: 'Who can view' } ) );
	const options = await screen.findAllByRole( 'option', { name: /^(Only you|Everyone)$/ } );
	expect( options ).toHaveLength( 2 );
	expect( options[ 0 ] ).toHaveAccessibleName( 'Only you' );
	expect( options[ 1 ] ).toHaveAccessibleName( 'Everyone' );
	expect( options[ 1 ] ).toHaveAttribute( 'aria-selected', 'true' );
	expect( screen.getByText( 'Visitors see a coming soon page' ) ).toBeVisible();
	expect( screen.getByText( 'Your WordPress is public' ) ).toBeVisible();
	expect( connector.setSiteVisibility ).not.toHaveBeenCalled();
} );

it.each( [ 'local', 'preview', 'unlaunched', 'launched' ] as const )(
	'uses the top-bar label and tooltip for a %s site before opening the panel',
	async ( state ) => {
		const connected = state === 'unlaunched' || state === 'launched';
		const connector = setup( {
			getRemoteSites: async () =>
				connected
					? [
							{
								id: 42,
								localSiteId: 'local',
								name: 'Remote',
								url: 'https://old-address.wpcomstaging.com',
								isStaging: false,
								isPressable: false,
								syncSupport: 'syncable',
								lastPullTimestamp: null,
								lastPushTimestamp: null,
							},
					  ]
					: [],
			getSiteVisibility: async () => ( {
				visibility: state === 'launched' ? 'public' : 'coming-soon',
				launchStatus: state === 'launched' ? 'launched' : 'unlaunched',
				url: 'https://current-domain.blog/',
			} ),
		} );
		if ( state === 'preview' )
			connector.getSnapshots.mockResolvedValue( [
				{
					atomicSiteId: 123,
					localSiteId: connector.state.sites[ 0 ].id,
					userId: TEST_USER.id,
					date: Date.now(),
					url: 'preview.wpcomstaging.com',
				},
			] );
		const actions = userEvent.setup();
		const button = await screen.findByRole( 'button', {
			name: 'Publish…',
		} );
		expect( button ).toHaveTextContent( 'Publish' );
		expect( button.querySelector( 'svg' ) ).not.toBeInTheDocument();
		await actions.hover( button );
		expect( await screen.findByText( 'Share a preview or publish your site' ) ).toBeVisible();
		expect( screen.queryByRole( 'dialog', { name: publishPanelName } ) ).not.toBeInTheDocument();
		await actions.click( button );
		const panel = await screen.findByRole( 'dialog', {
			name: publishPanelName,
		} );
		expect( panel ).toBeVisible();
		expect(
			within( panel ).queryByRole( 'heading', { name: /^(Details|Suggested)$/ } )
		).not.toBeInTheDocument();
		expect( connector.publishPreviewSite ).not.toHaveBeenCalled();
		expect( connector.openExternalUrl ).not.toHaveBeenCalled();
	}
);

it.each( [ false, true, null ] )(
	'shows the launched action for localChanged=%s',
	async ( localChanged ) => {
		const remote = {
			id: 42,
			localSiteId: 'local',
			name: 'Live',
			url: 'https://old.wpcomstaging.com',
			isStaging: false,
			isPressable: false,
			syncSupport: 'syncable' as const,
			lastPushTimestamp: new Date( Date.now() - 2 * 60 * 60 * 1000 ).toISOString(),
			lastPullTimestamp: null,
		};
		const connector = setup( {
			getRemoteSites: async () => [ remote ],
			listAccountSites: async () => [ remote ],
			getSitePublishStatus: async () => ( { localChanged } ),
			getSiteVisibility: async () => ( {
				visibility: 'public',
				launchStatus: 'launched',
				url: 'https://actual.blog/',
			} ),
		} );
		const actions = userEvent.setup();
		await actions.click( await screen.findByRole( 'button', { name: 'Publish…' } ) );
		const published = await screen.findByRole( 'time' );
		expect( published ).toBeVisible();
		expect( published ).toHaveTextContent( /^Last updated / );
		expect( published ).toHaveAttribute( 'datetime', remote.lastPushTimestamp );
		expect( screen.queryByText( 'Your latest changes are live.' ) ).not.toBeInTheDocument();
		expect(
			screen.queryByText( "You have changes that aren't live yet." )
		).not.toBeInTheDocument();
		expect( !! screen.queryByRole( 'img', { name: 'Local changes' } ) ).toBe(
			localChanged === true
		);
		expect( await screen.findByRole( 'button', { name: 'Update…' } ) ).toBeVisible();
		expect( screen.queryByRole( 'heading', { name: 'Published site' } ) ).not.toBeInTheDocument();
		expect( screen.queryByRole( 'heading', { name: 'Actions' } ) ).not.toBeInTheDocument();
		await actions.click( screen.getByRole( 'button', { name: 'Site actions' } ) );
		const menu = await screen.findByRole( 'menu', { name: 'Site actions' } );
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
		await actions.keyboard( '{Escape}' );
		const openSite = screen.getByRole( 'link', { name: 'Open actual.blog' } );
		expect( within( openSite ).getByText( 'actual.blog', { exact: true } ) ).toBeVisible();
		expect( openSite ).toHaveAttribute( 'href', 'https://actual.blog/' );
		await actions.click( openSite );
		expect( connector.openExternalUrl ).toHaveBeenCalledExactlyOnceWith( 'https://actual.blog/' );
		await actions.click( screen.getByRole( 'button', { name: 'Site actions' } ) );
		await actions.click( await screen.findByRole( 'menuitem', { name: 'Copy link' } ) );
		expect( connector.copyText ).toHaveBeenCalledWith( 'https://actual.blog/' );
		expect( connector.pushSite ).not.toHaveBeenCalled();
	}
);

it( 'offers provider settings instead of a dead-end retry when visibility API access is blocked', async () => {
	const connector = setupHostedVisibility();
	connector.getSiteVisibility.mockRejectedValue(
		new Error( 'API calls to this blog have been disabled.' )
	);
	const actions = userEvent.setup();
	await actions.click( await screen.findByRole( 'button', { name: /^Publish…$/ } ) );
	await actions.click( screen.getByRole( 'combobox', { name: 'Who can view' } ) );
	for ( const option of await screen.findAllByRole( 'option', {
		name: /^(Only you|Everyone|Invited people|Restricted)$/,
	} ) )
		expect( option ).toHaveAttribute( 'aria-disabled', 'true' );
	expect( screen.queryByRole( 'button', { name: 'Try again' } ) ).not.toBeInTheDocument();
	expect( screen.getByRole( 'combobox', { name: 'Who can view' } ) ).toHaveAccessibleDescription(
		'Access unknown'
	);
	await actions.click( screen.getByRole( 'option', { name: 'Manage on WordPress.com' } ) );
	expect( connector.openExternalUrl ).toHaveBeenCalledWith(
		'https://wordpress.com/settings/general/42'
	);
	expect( connector.setSiteVisibility ).not.toHaveBeenCalled();
} );

it( 'offers provider settings while visibility loads and shows the confirmed value when ready', async () => {
	const connector = setupHostedVisibility();
	let finish!: () => void;
	connector.getSiteVisibility.mockImplementation(
		() =>
			new Promise( ( resolve ) => {
				finish = () =>
					resolve( { visibility: 'public', url: 'https://hosted.blog', launchStatus: 'launched' } );
			} )
	);
	const actions = userEvent.setup();
	await actions.click( await screen.findByRole( 'button', { name: /^Publish…$/ } ) );
	expect(
		await screen.findByRole( 'combobox', { name: 'Who can view' } )
	).toHaveAccessibleDescription( 'Checking access…' );
	await actions.click( screen.getByRole( 'combobox', { name: 'Who can view' } ) );
	expect( await screen.findByRole( 'option', { name: 'Manage on WordPress.com' } ) ).toBeVisible();
	await act( async () => finish() );
	await waitFor( () =>
		expect( screen.getByRole( 'combobox', { name: 'Who can view' } ) ).toHaveAccessibleDescription(
			'Everyone'
		)
	);
	expect( screen.getByRole( 'option', { name: 'Everyone', selected: true } ) ).toBeVisible();
	expect( screen.getByRole( 'option', { name: 'Manage on WordPress.com' } ) ).toBeVisible();
} );
