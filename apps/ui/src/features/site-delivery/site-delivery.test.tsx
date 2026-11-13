import { SNAPSHOT_EVENTS } from '@studio/common/lib/cli-events';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { getVisibleToasts } from '@/data/app-messages';
import { buildPublishCheckoutUrl } from '@/data/core/connectors/publish-checkout-url';
import { applySyncActivity } from '@/data/sync-activity';
import { requestHeaderPanel } from '@/data/use-open-header-panel';
import { createFakeConnector, makeSite, TEST_USER } from '@/test/fake-connector';
import { renderWithProviders } from '@/test/render';
import { PublishButton, ShareButton } from './index';
import type { Connector, Snapshot } from '@/data/core';

let siteCount = 0;
function setup( overrides: Partial< Connector > = {}, signedIn = true ) {
	const site = makeSite( { id: `delivery-${ ++siteCount }` } );
	let snapshots: Snapshot[] = [];
	const connector = createFakeConnector(
		{ sites: [ site ], user: signedIn ? TEST_USER : null },
		{
			capabilities: { nativeSites: false },
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
	renderWithProviders(
		<>
			<ShareButton site={ site } />
			<PublishButton site={ site } />
		</>,
		{ connector }
	);
	return connector;
}

async function previewAction( actions: ReturnType< typeof userEvent.setup >, name: string ) {
	await actions.click(
		screen.queryByRole( 'button', { name: 'Preview options' } ) ??
			( await screen.findByRole( 'button', { name: 'More options' } ) )
	);
	return screen.findByRole( 'menuitem', { name } );
}

async function selectDestination(
	actions: ReturnType< typeof userEvent.setup >,
	hostname: string
) {
	await actions.click( await screen.findByRole( 'button', { name: 'Choose destination' } ) );
	const menu = await screen.findByRole( 'menu', { name: 'Destinations' } );
	await actions.click( within( menu ).getByRole( 'menuitemradio', { name: hostname } ) );
}

it( 'opens the replacement panel from the Share entry point without creating anything', async () => {
	const connector = setup();
	fireEvent.click( await screen.findByRole( 'button', { name: 'Share' } ) );
	expect( await screen.findByRole( 'dialog', { name: 'Share' } ) ).toBeVisible();
	expect( screen.queryByRole( 'tab' ) ).not.toBeInTheDocument();
	expect( connector.publishPreviewSite ).not.toHaveBeenCalled();
} );
async function copyPreviewLink( actions: ReturnType< typeof userEvent.setup > ) {
	await actions.click( await screen.findByRole( 'button', { name: 'Copy link' } ) );
	await screen.findByRole( 'button', { name: 'Copied' } );
}

it( 'routes external publishing requests to the replacement panel', async () => {
	const connector = setup();
	await screen.findByRole( 'button', { name: 'Share…' } );
	act( () =>
		requestHeaderPanel( {
			panel: 'publish',
			siteId: connector.state.sites[ 0 ].id,
			view: 'publish',
		} )
	);
	expect( await screen.findByRole( 'dialog', { name: 'Share' } ) ).toBeVisible();
	expect( screen.queryByRole( 'tab' ) ).not.toBeInTheDocument();
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
		const button = await screen.findByRole( 'button', { name: /^(Share|Publish)…$/ } );
		await actions.click( button );
		expect( await screen.findByRole( 'dialog', { name: /^(Share|Publish)$/ } ) ).toBeVisible();
		expect( screen.queryByRole( 'dialog', { name: 'Share and publish' } ) ).not.toBeInTheDocument();
		expect( connector.publishPreviewSite ).not.toHaveBeenCalled();
		await actions.click( await screen.findByRole( 'button', { name: 'Create preview link' } ) );
		await waitFor( () => expect( connector.publishPreviewSite ).toHaveBeenCalledTimes( 1 ) );
		await screen.findByRole( 'button', { name: 'Open preview: My preview' } );
		expect( screen.getByText( 'My preview' ) ).toBeVisible();
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
		expect( await screen.findByRole( 'dialog', { name: /^(Share|Publish)$/ } ) ).toBeVisible();
		expect( connector.publishPreviewSite ).toHaveBeenCalledTimes( 1 );
	} );
	it( 'uses the shared spinner during publishing', async () => {
		const connector = setup();
		const button = await screen.findByRole( 'button', { name: /^(Share|Publish)…$/ } );
		act( () => {
			applySyncActivity( connector.state.sites[ 0 ].id, { kind: 'pending', direction: 'preview' } );
		} );
		expect( button.querySelector( '[data-slot="spinner"]' ) ).toBeInTheDocument();
		expect( button ).toHaveAccessibleDescription( 'Publishing…' );
	} );
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
	const button = await screen.findByRole( 'button', { name: /^(Share|Publish)…$/ } );
	await actions.click( button );
	await actions.click( await screen.findByRole( 'button', { name: 'Create preview link' } ) );
	await waitFor( () => expect( connector.publishPreviewSite ).toHaveBeenCalledTimes( 1 ) );
	expect( button.querySelector( '[data-slot="spinner"]' ) ).toBeInTheDocument();
	expect(
		getVisibleToasts().some(
			( notice ) => notice.id === `preview-${ connector.state.sites[ 0 ].id }` && ! notice.leaving
		)
	).toBe( false );
	const creatingButton = screen.getByRole( 'button', { name: 'Creating preview link…' } );
	expect( creatingButton ).toHaveAttribute( 'aria-busy', 'true' );
	expect( creatingButton ).toHaveAttribute( 'aria-disabled', 'true' );
	expect( creatingButton.querySelector( '[data-slot="spinner"]' ) ).toBeInTheDocument();
	await actions.keyboard( '{Escape}' );
	await waitFor( () => expect( screen.queryByRole( 'dialog' ) ).not.toBeInTheDocument() );
	await actions.click( button );
	expect( await screen.findByRole( 'dialog', { name: /^(Share|Publish)$/ } ) ).toBeVisible();
	expect( screen.getByRole( 'button', { name: 'Creating preview link…' } ) ).toHaveAttribute(
		'aria-disabled',
		'true'
	);
	expect( connector.publishPreviewSite ).toHaveBeenCalledTimes( 1 );
	const panel = screen.getByRole( 'dialog', { name: 'Share' } );
	expect( within( panel ).getByText( 'Destination' ) ).toBeVisible();
	expect( within( panel ).getByRole( 'button', { name: 'Make it public' } ) ).toBeVisible();
	expect( within( panel ).queryByRole( 'heading', { name: 'Previews' } ) ).not.toBeInTheDocument();
	expect(
		within( panel ).queryByRole( 'button', { name: 'New preview' } )
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
		await within( panel ).findByRole( 'button', {
			name: 'Open preview: Preview 1',
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
	const trigger = await screen.findByRole( 'button', { name: 'Share…' } );
	await user.click( trigger );
	const panel = await screen.findByRole( 'dialog', { name: 'Share' } );
	const create = within( panel ).getByRole( 'button', { name: 'Create preview link' } );
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
	await actions.click( await screen.findByRole( 'button', { name: /^(Share|Publish)…$/ } ) );
	await screen.findByRole( 'dialog', { name: /^(Share|Publish)$/ } );
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
	await actions.click( await screen.findByRole( 'button', { name: /^(Share|Publish)…$/ } ) );
	expect( await screen.findByRole( 'dialog', { name: /^(Share|Publish)$/ } ) ).toBeVisible();
	await waitFor( () =>
		expect(
			screen
				.getByRole( 'button', { name: /^(Share|Publish)…$/ } )
				.querySelector( '[data-slot="spinner"]' )
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
	const button = await screen.findByRole( 'button', { name: /^(Share|Publish)…$/ } );
	await actions.click( button );
	expect( connector.publishPreviewSite ).toHaveBeenCalledTimes( 0 );
	await actions.click( await screen.findByRole( 'button', { name: 'Create preview link' } ) );
	await waitFor( () =>
		expect(
			getVisibleToasts().some( ( toast ) => toast.description === 'Preview upload failed' )
		).toBe( true )
	);
	expect( document.querySelector( '[data-slot="preview-row-skeleton"]' ) ).not.toBeInTheDocument();
	expect( connector.publishPreviewSite ).toHaveBeenCalledTimes( 1 );
	await actions.keyboard( '{Escape}' );
	await waitFor( () => expect( screen.queryByRole( 'dialog' ) ).not.toBeInTheDocument() );
	await actions.click( button );
	expect( connector.publishPreviewSite ).toHaveBeenCalledTimes( 1 );
	await actions.click( await screen.findByRole( 'button', { name: 'Create preview link' } ) );
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
			expect(
				await screen.findByRole( 'button', { name: /^(Share|Publish)…$/ } )
			).toHaveTextContent( 'Share' );
			expect(
				screen.getByRole( 'button', { name: /^(Share|Publish)…$/ } ).querySelector( 'svg' )
			).toBeInTheDocument();
		} else {
			expect(
				screen
					.getByRole( 'button', { name: /^(Share|Publish)…$/ } )
					.querySelector( '[data-slot="notification-dot"]' )
			).not.toBeInTheDocument();
			expect( screen.getByRole( 'button', { name: /^(Share|Publish)…$/ } ) ).toHaveTextContent(
				/^Share$/
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
			shareUrl: 'https://latest.example.com/?preview=share',
		},
	] );
	const actions = userEvent.setup();
	await actions.click( await screen.findByRole( 'button', { name: /^(Share|Publish)…$/ } ) );
	expect(
		await screen.findByText( 'Anyone with the link can view this preview until it expires.' )
	).toBeVisible();
	expect( screen.getByRole( 'button', { name: 'More options' } ) ).toBeVisible();
	expect( screen.getByRole( 'dialog', { name: /^(Share|Publish)$/ } ) ).toBeVisible();
	expect(
		screen.queryByRole( 'button', { name: 'WordPress.com dashboard' } )
	).not.toBeInTheDocument();
	const update = await screen.findByRole( 'button', { name: 'Update preview' } );
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
	expect( update ).toHaveAccessibleName( 'Updating preview…' );
	expect( update ).toHaveAttribute( 'aria-busy', 'true' );
	expect( update.querySelector( '[data-slot="spinner"]' ) ).toBeInTheDocument();
	expect( update ).toHaveAttribute( 'aria-disabled', 'true' );
	await actions.click( update );
	expect( connector.publishPreviewSite ).toHaveBeenCalledTimes( 1 );
	await act( async () => finish() );
	await screen.findByRole( 'button', { name: /^(Share|Publish)…$/ } );
	expect( screen.queryByRole( 'button', { name: 'Done' } ) ).not.toBeInTheDocument();
	await waitFor( () =>
		expect( screen.getByRole( 'button', { name: 'Copy link' } ) ).not.toHaveAttribute(
			'aria-disabled',
			'true'
		)
	);
	expect(
		screen
			.getByRole( 'button', { name: /^(Share|Publish)…$/ } )
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
	const trigger = await screen.findByRole( 'button', { name: /^(Share|Publish)…$/ } );
	await actions.click( trigger );
	expect( await screen.findByText( 'Expires Nov 17', { selector: 'span' } ) ).toBeVisible();
	await actions.click( await previewAction( actions, 'Delete preview' ) );
	const confirmation = await screen.findByRole( 'alertdialog', { name: 'Delete preview?' } );
	expect( confirmation ).toBeVisible();
	expect( confirmation ).toHaveAccessibleDescription(
		'Anyone with the link will lose access, and this can’t be undone. Your local WordPress won’t change.'
	);
	expect( within( confirmation ).getByText( 'Expires Nov 17' ) ).toBeVisible();
	expect( within( confirmation ).queryByText( /^Updated / ) ).not.toBeInTheDocument();
	expect( screen.queryByRole( 'dialog', { name: /^(Share|Publish)$/ } ) ).not.toBeInTheDocument();
	expect( connector.deleteSnapshot ).not.toHaveBeenCalled();
	await actions.click( screen.getByRole( 'button', { name: 'Cancel' } ) );
	await waitFor( () => expect( screen.queryByRole( 'alertdialog' ) ).not.toBeInTheDocument() );
	expect( trigger ).toHaveFocus();
	await actions.click( trigger );
	await actions.click( await previewAction( actions, 'Delete preview' ) );
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
	await actions.click( await screen.findByRole( 'button', { name: /^(Share|Publish)…$/ } ) );
	const panel = await screen.findByRole( 'dialog', { name: 'Share' } );
	expect( within( panel ).queryByRole( 'heading', { name: 'Previews' } ) ).not.toBeInTheDocument();
	expect(
		within( panel ).queryByRole( 'button', { name: 'New preview' } )
	).not.toBeInTheDocument();
	await actions.click( within( panel ).getByRole( 'button', { name: 'More options' } ) );
	expect(
		( await screen.findAllByRole( 'menuitem' ) ).map( ( item ) => item.textContent?.trim() )
	).toEqual( [
		'New preview',
		'Rename',
		'Update preview',
		'Pull from preview',
		'Connect existing site',
		'Delete preview',
	] );
	await actions.click( screen.getByRole( 'menuitem', { name: 'New preview' } ) );
	await waitFor( () =>
		expect( connector.publishPreviewSite ).toHaveBeenCalledExactlyOnceWith(
			snapshot.localSiteId,
			undefined,
			undefined
		)
	);
	expect( screen.getByRole( 'button', { name: /^(Share|Publish)…$/ } ) ).toBeVisible();
	expect(
		within( screen.getByRole( 'dialog', { name: /^(Share|Publish)$/ } ) ).queryByText(
			'Creating preview…'
		)
	).not.toBeInTheDocument();
	expect( await screen.findByRole( 'button', { name: 'Creating preview link…' } ) ).toHaveAttribute(
		'aria-busy',
		'true'
	);
	const skeleton = panel.querySelector( '[data-slot="preview-row-skeleton"]' );
	expect( skeleton ).toBeVisible();
	expect(
		within( panel ).queryByRole( 'button', { name: /^Open preview:/ } )
	).not.toBeInTheDocument();
	await actions.click( within( panel ).getByRole( 'button', { name: 'More options' } ) );
	const create = await screen.findByRole( 'menuitem', { name: 'New preview' } );
	expect( create ).toHaveAttribute( 'aria-disabled', 'true' );
	await actions.click( create );
	expect( connector.publishPreviewSite ).toHaveBeenCalledTimes( 1 );
	await actions.keyboard( '{Escape}' );
	act( () =>
		connector.emit( 'onSnapshotEvent', {
			event: SNAPSHOT_EVENTS.CREATED,
			snapshotUrl: newSnapshot.url,
			snapshot: newSnapshot,
		} )
	);
	await waitFor( () => expect( skeleton ).not.toBeInTheDocument() );
	await act( async () => finish() );
	await screen.findByRole( 'button', { name: 'Open preview: Preview 2' } );
	expect( skeleton ).not.toBeInTheDocument();
	expect( within( panel ).getAllByRole( 'button', { name: /^Open preview:/ } ) ).toHaveLength( 1 );
	const picker = within( panel ).getByRole( 'button', { name: 'Choose destination' } );
	await waitFor( () => expect( picker ).toBeEnabled() );
	await actions.click( picker );
	const options = await within(
		await screen.findByRole( 'menu', { name: 'Destinations' } )
	).findAllByRole( 'menuitemradio' );
	expect( options.map( ( option ) => option.getAttribute( 'aria-label' ) ) ).toEqual( [
		'Preview 2',
		'Preview 1',
	] );
	expect( options[ 0 ] ).toBeChecked();
	await actions.keyboard( '{Escape}' );
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
		const trigger = await screen.findByRole( 'button', { name: /^(Share|Publish)…$/ } );
		await actions.click( trigger );
		await actions.click( await screen.findByRole( 'button', { name: 'More options' } ) );
		const create = await screen.findByRole( 'menuitem', { name: 'New preview' } );
		if ( blocked ) {
			expect( create ).toHaveAttribute( 'aria-disabled', 'true' );
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
		expiresAt: new Date( 2099, 10, 17, 12 ).getTime(),
	};
	connector.getSnapshots.mockResolvedValue( [ older, newer ] );
	connector.deleteSnapshot.mockImplementation( async () => {
		connector.getSnapshots.mockResolvedValue( [ newer ] );
	} );
	const actions = userEvent.setup();
	await actions.click( await screen.findByRole( 'button', { name: /^(Share|Publish)…$/ } ) );
	expect( screen.getByRole( 'button', { name: 'Choose destination' } ) ).toBeVisible();
	expect( screen.getByRole( 'button', { name: 'Open preview: Newer preview' } ) ).toBeVisible();
	expect( screen.getByText( 'Expires Nov 18', { selector: 'span' } ) ).toBeVisible();
	await selectDestination( actions, 'Older preview' );
	expect( screen.getByRole( 'button', { name: 'Open preview: Older preview' } ) ).toBeVisible();
	expect(
		within( screen.getByRole( 'dialog', { name: 'Share' } ) )
			.getAllByRole( 'button', { name: /^Open preview:/ } )
			.map( ( row ) => row.getAttribute( 'aria-label' ) )
	).toEqual( [ 'Open preview: Older preview' ] );
	expect( screen.getByText( 'Expires Nov 17', { selector: 'span' } ) ).toBeVisible();
	await actions.click( await screen.findByRole( 'button', { name: 'Update preview' } ) );
	await waitFor( () =>
		expect( connector.publishPreviewSite ).toHaveBeenCalledExactlyOnceWith(
			base.localSiteId,
			older.url,
			undefined
		)
	);
	await waitFor( () =>
		expect( screen.getByRole( 'button', { name: 'Copy link' } ) ).not.toHaveAttribute(
			'aria-disabled',
			'true'
		)
	);
	expect( screen.getByRole( 'button', { name: 'Open preview: Older preview' } ) ).toBeVisible();
	await copyPreviewLink( actions );
	expect( connector.copyText ).toHaveBeenCalledWith( older.shareUrl );
	await waitFor( () =>
		expect( screen.getByRole( 'button', { name: 'Make it public' } ) ).toBeEnabled()
	);
	await actions.click( screen.getByRole( 'button', { name: 'Make it public' } ) );
	await waitFor( () => expect( connector.openExternalUrl ).toHaveBeenCalled() );
	expect( connector.openExternalUrl ).toHaveBeenCalledWith(
		buildPublishCheckoutUrl( connector.state.sites[ 0 ] )
	);
	await waitFor(
		() =>
			expect( screen.getByRole( 'button', { name: 'More options' } ) ).not.toHaveAttribute(
				'aria-disabled',
				'true'
			),
		{ timeout: 3000 }
	);
	await actions.click( screen.getByRole( 'button', { name: 'Open preview: Older preview' } ) );
	expect( connector.openExternalUrl ).toHaveBeenLastCalledWith( older.shareUrl );
	await selectDestination( actions, 'Newer preview' );
	expect(
		screen.queryByRole( 'button', { name: 'More options for newer.example.com' } )
	).not.toBeInTheDocument();
	await copyPreviewLink( actions );
	await waitFor( () =>
		expect( connector.copyText ).toHaveBeenLastCalledWith( 'https://newer.example.com' )
	);
	expect( connector.openExternalUrl ).toHaveBeenLastCalledWith( older.shareUrl );
} );

it( 'confirms before pulling the preview for the row and supports retry after failure', async () => {
	let finish!: () => void;
	const connector = setup( {
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
	const trigger = await screen.findByRole( 'button', { name: /^(Share|Publish)…$/ } );
	await actions.click( trigger );
	await selectDestination( actions, 'Preview 1' );
	await actions.click( await previewAction( actions, 'Pull from preview' ) );
	const dialog = await screen.findByRole( 'alertdialog', { name: 'Pull preview?' } );
	expect( dialog ).toHaveTextContent(
		"This replaces your local WordPress with the preview. Any changes you haven't pushed will be lost."
	);
	expect( connector.pullSite ).not.toHaveBeenCalled();
	await actions.click( screen.getByRole( 'button', { name: 'Cancel' } ) );
	await waitFor( () => expect( screen.queryByRole( 'alertdialog' ) ).not.toBeInTheDocument() );
	expect( trigger ).toHaveFocus();
	await actions.click( trigger );
	await actions.click( await previewAction( actions, 'Pull from preview' ) );
	await screen.findByRole( 'alertdialog', { name: 'Pull preview?' } );
	await actions.click( screen.getByRole( 'button', { name: 'Pull preview' } ) );
	await waitFor( () =>
		expect( connector.pullSite ).toHaveBeenCalledExactlyOnceWith(
			'wpcom',
			base.localSiteId,
			123,
			undefined
		)
	);
	expect( await screen.findByRole( 'alert' ) ).toHaveTextContent(
		'Could not pull this preview. Please try again.'
	);
	expect( screen.queryByText( 'Preview pull failed' ) ).not.toBeInTheDocument();
	const pull = screen.getByRole( 'button', { name: 'Pull preview' } );
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
	expect( trigger ).toHaveFocus();
	expect( connector.publishPreviewSite ).not.toHaveBeenCalled();
} );

it.each( [ false, true ] )(
	'shows preview edits and confirms before replacing them, local changes: %s',
	async ( localChanged ) => {
		let previewChanged = true;
		const connector = setup( {
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
				date: Date.now(),
			},
		] );
		const actions = userEvent.setup();
		await actions.click(
			await screen.findByRole( 'button', {
				name: /^(Share|Publish)…$/,
			} )
		);
		expect(
			await screen.findByText( localChanged ? 'Local and preview changes' : 'Preview has changes' )
		).toBeVisible();
		await actions.click( screen.getByRole( 'button', { name: 'Pull from preview' } ) );
		await screen.findByRole( 'alertdialog', { name: 'Pull preview?' } );
		expect( connector.pullSite ).not.toHaveBeenCalled();
		await actions.click( screen.getByRole( 'button', { name: 'Cancel' } ) );
		await actions.click( screen.getByRole( 'button', { name: /^(Share|Publish)…$/ } ) );
		if ( ! localChanged ) {
			expect( await screen.findByRole( 'button', { name: 'Copy link' } ) ).toBeVisible();
			return;
		}
		await actions.click( screen.getByRole( 'button', { name: 'Update preview' } ) );
		await screen.findByText( 'Replace preview changes?' );
		expect( connector.publishPreviewSite ).not.toHaveBeenCalled();
		expect( connector.openExternalUrl ).not.toHaveBeenCalled();
		await actions.click( screen.getByRole( 'button', { name: 'Cancel' } ) );
		expect( connector.publishPreviewSite ).not.toHaveBeenCalled();
		await actions.click( screen.getByRole( 'button', { name: 'Update preview' } ) );
		await actions.click( await screen.findByRole( 'button', { name: 'Replace preview' } ) );
		await waitFor( () =>
			expect( connector.publishPreviewSite ).toHaveBeenCalledExactlyOnceWith(
				connector.state.sites[ 0 ].id,
				'edited.example.com',
				undefined
			)
		);
		expect( connector.openExternalUrl ).not.toHaveBeenCalled();
	}
);

it( 'defaults to the connected website and keeps preview updates separate from live publishing', async () => {
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
	await actions.click( await screen.findByRole( 'button', { name: /^(Share|Publish)…$/ } ) );
	expect( screen.getByRole( 'button', { name: 'published.example.com' } ) ).toBeVisible();
	expect( screen.queryByRole( 'button', { name: 'Copy preview link' } ) ).not.toBeInTheDocument();
	expect( await screen.findByRole( 'button', { name: 'Update preview' } ) ).toBeVisible();
	expect( screen.getByRole( 'button', { name: 'Who can view' } ) ).toBeVisible();
	await waitFor( () =>
		expect( screen.getByRole( 'button', { name: 'Publish changes' } ) ).toBeEnabled()
	);
	await actions.click( screen.getByRole( 'button', { name: 'Publish changes' } ) );
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
	await actions.click( await screen.findByRole( 'button', { name: /^(Share|Publish)…$/ } ) );
	expect(
		await screen.findByText( 'Anyone with the link can view this preview until it expires.' )
	).toBeVisible();
	expect( screen.queryByRole( 'button', { name: 'Choose destination' } ) ).not.toBeInTheDocument();
	expect( screen.queryByRole( 'button', { name: 'Publish changes' } ) ).not.toBeInTheDocument();
	expect( screen.getByRole( 'button', { name: 'More options' } ) ).toBeVisible();
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
		await actions.click( await screen.findByRole( 'button', { name: /^(Share|Publish)…$/ } ) );
		await actions.click( await previewAction( actions, 'Delete preview' ) );
		await actions.click( await screen.findByRole( 'button', { name: 'Delete preview' } ) );
		await waitFor( () => expect( screen.queryByRole( 'alertdialog' ) ).not.toBeInTheDocument() );
		expect( screen.queryByRole( 'dialog', { name: /^(Share|Publish)$/ } ) ).not.toBeInTheDocument();
		expect( connector.publishPreviewSite ).not.toHaveBeenCalled();
		const trigger = screen.getByRole( 'button', { name: /^(Share|Publish)…$/ } );
		expect( trigger ).toHaveFocus();
		expect( screen.queryByText( /Expires Nov/, { selector: 'span' } ) ).not.toBeInTheDocument();
		await actions.click( trigger );
		if ( hasLiveSite ) {
			expect( screen.queryByRole( 'button', { name: 'Add a domain' } ) ).not.toBeInTheDocument();
			expect( await screen.findByRole( 'button', { name: 'Publish changes' } ) ).toBeEnabled();
			expect( connector.publishPreviewSite ).not.toHaveBeenCalled();
		} else {
			expect( connector.publishPreviewSite ).not.toHaveBeenCalled();
			await actions.click( await screen.findByRole( 'button', { name: 'Create preview link' } ) );
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
	await actions.click( await screen.findByRole( 'button', { name: /^(Share|Publish)…$/ } ) );
	expect( screen.queryByText( 'Changes could not be checked.' ) ).not.toBeInTheDocument();
	await actions.click( screen.getByRole( 'button', { name: 'Update preview' } ) );
	expect( await screen.findByText( 'Replace preview contents?' ) ).toBeVisible();
	expect( screen.getByText( /Changes on unknown.example.com could not be checked/ ) ).toBeVisible();
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
	'reflects %s progress and restores the resting Publish label',
	async ( direction, hostname, label ) => {
		const connector = setup();
		const button = await screen.findByRole( 'button', { name: /^(Share|Publish)…$/ } );
		expect( button.querySelector( 'svg' ) ).toBeInTheDocument();
		await act( () =>
			applySyncActivity( connector.state.sites[ 0 ].id, { kind: 'pending', direction, hostname } )
		);
		expect( button ).toHaveAccessibleName( 'Share…' );
		expect( button ).toHaveTextContent( 'Share' );
		expect( button ).toHaveAccessibleDescription( label );
		expect( button.querySelector( '[data-slot="spinner"]' ) ).toBeInTheDocument();
		await act( () =>
			applySyncActivity( connector.state.sites[ 0 ].id, { kind: 'success', direction } )
		);
		expect( button ).toHaveAccessibleName( 'Share…' );
		expect( button.querySelector( '[data-slot="spinner"]' ) ).not.toBeInTheDocument();
		expect( button.querySelector( 'svg' ) ).toBeInTheDocument();
	}
);

it( 'shows checkout progress on the row, reopens the same URL, and resets on close', async () => {
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
		},
	] );
	const actions = userEvent.setup();
	await actions.click( await screen.findByRole( 'button', { name: /^(Share|Publish)…$/ } ) );
	expect(
		await screen.findByRole( 'button', { name: 'Make it public' } )
	).toHaveAccessibleDescription( 'The full WordPress, with a domain' );
	expect( screen.getByText( 'Preview 1' ) ).toBeVisible();
	let finishHandoff!: () => void;
	connector.openExternalUrl.mockImplementationOnce(
		() => new Promise< void >( ( resolve ) => ( finishHandoff = resolve ) )
	);
	expect( await screen.findByRole( 'button', { name: 'Copy link' } ) ).toBeVisible();
	await actions.click( screen.getByRole( 'button', { name: 'Make it public' } ) );
	await waitFor( () => expect( connector.openExternalUrl ).toHaveBeenCalledTimes( 1 ) );
	const row = screen.getByRole( 'button', { name: 'Make it public' } );
	expect( row ).toHaveAccessibleDescription( 'Opening WordPress.com' );
	expect( row.querySelector( '[data-slot="spinner"]' ) ).toBeInTheDocument();
	expect( screen.getByRole( 'button', { name: 'Copy link' } ) ).toBeDisabled();
	expect( screen.getByRole( 'button', { name: 'Open preview: Preview 1' } ) ).toBeDisabled();
	const url = new URL( connector.openExternalUrl.mock.calls[ 0 ][ 0 ] );
	expect( url.origin + url.pathname ).toBe( 'https://wordpress.com/setup/new-hosted-site' );
	expect( url.searchParams.get( 'studioSiteId' ) ).toBe( connector.state.sites[ 0 ].id );
	expect( url.searchParams.get( 'autoOpenPush' ) ).toBe( 'true' );
	expect( connector.publishPreviewSite ).not.toHaveBeenCalled();
	expect(
		screen.queryByRole( 'dialog', { name: 'Your website address' } )
	).not.toBeInTheDocument();
	expect( screen.getByRole( 'button', { name: 'More options' } ) ).toBeVisible();

	await act( async () => finishHandoff() );
	expect( await screen.findByText( 'Finish setting up on WordPress.com.' ) ).toBeVisible();
	expect( row ).toHaveAccessibleDescription( 'Waiting for your new site' );
	expect( row.querySelector( '[data-slot="spinner"]' ) ).toBeInTheDocument();
	const reopen = screen.getByRole( 'button', { name: 'Reopen WordPress.com' } );
	expect( reopen ).toHaveAttribute( 'data-variant', 'outline' );
	await actions.click( reopen );
	expect( connector.openExternalUrl ).toHaveBeenCalledTimes( 2 );
	expect( connector.openExternalUrl ).toHaveBeenLastCalledWith( url.toString() );

	const closeAndReopen = async () => {
		await actions.keyboard( '{Escape}' );
		await waitFor( () =>
			expect( screen.queryByRole( 'dialog', { name: 'Share' } ) ).not.toBeInTheDocument()
		);
		await actions.click( screen.getByRole( 'button', { name: 'Share…' } ) );
		expect( screen.getByRole( 'button', { name: 'Copy link' } ) ).toBeEnabled();
		expect(
			screen.queryByRole( 'button', { name: 'Reopen WordPress.com' } )
		).not.toBeInTheDocument();
	};
	await closeAndReopen();

	connector.openExternalUrl.mockImplementationOnce(
		() => new Promise< void >( ( resolve ) => ( finishHandoff = resolve ) )
	);
	await actions.click( screen.getByRole( 'button', { name: 'Make it public' } ) );
	await waitFor( () => expect( connector.openExternalUrl ).toHaveBeenCalledTimes( 3 ) );
	await closeAndReopen();
	await act( async () => finishHandoff() );
	expect(
		screen.queryByRole( 'button', { name: 'Reopen WordPress.com' } )
	).not.toBeInTheDocument();
} );

it.each( [ false, true ] )(
	'selects the new site for its first publish after checkout (panel closed: %s)',
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
		await actions.click( await screen.findByRole( 'button', { name: 'Share…' } ) );
		await actions.click( await screen.findByRole( 'button', { name: 'Make it public' } ) );
		await screen.findByRole( 'button', { name: 'Reopen WordPress.com' } );
		expect( connector.connectRemoteSite ).not.toHaveBeenCalled();
		if ( closed ) await actions.keyboard( '{Escape}' );

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
		if ( closed ) {
			expect( screen.queryByRole( 'dialog' ) ).not.toBeInTheDocument();
			await actions.click( await screen.findByRole( 'button', { name: 'Publish…' } ) );
		}
		expect( await screen.findByText( 'Not published yet' ) ).toBeVisible();
		expect( screen.getByRole( 'button', { name: 'new-site.blog' } ) ).toBeVisible();
		expect( screen.getByRole( 'button', { name: 'Publish' } ) ).toBeVisible();
		expect(
			screen.queryByRole( 'button', { name: 'Reopen WordPress.com' } )
		).not.toBeInTheDocument();
		expect( screen.queryByRole( 'button', { name: 'What to publish' } ) ).not.toBeInTheDocument();
		expect( connector.pushSite ).not.toHaveBeenCalled();
		expect( connector.publishPreviewSite ).not.toHaveBeenCalled();
		expect( connector.deleteSnapshot ).not.toHaveBeenCalled();
		await actions.click( screen.getByRole( 'button', { name: 'Publish' } ) );
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

it( 'opens checkout at the preview limit without creating a preview', async () => {
	const connector = setup( {
		getSnapshotUsage: async () => ( { siteCount: 5, siteLimit: 5, siteCreationBlocked: false } ),
	} );
	const actions = userEvent.setup();
	await actions.click( await screen.findByRole( 'button', { name: 'Share…' } ) );
	await actions.click( await screen.findByRole( 'button', { name: 'Make it public' } ) );
	await screen.findByRole( 'button', { name: 'Reopen WordPress.com' } );
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
	await actions.click( await screen.findByRole( 'button', { name: 'Share…' } ) );
	const row = await screen.findByRole( 'button', { name: 'Make it public' } );
	await actions.click( row );
	expect( await screen.findByRole( 'alert' ) ).toHaveTextContent( 'Could not open the browser.' );
	expect( row ).toBeEnabled();
	await actions.click( row );
	expect( await screen.findByRole( 'button', { name: 'Reopen WordPress.com' } ) ).toBeVisible();
	expect( connector.publishPreviewSite ).not.toHaveBeenCalled();
} );

it( 'keeps checklist choices live and publishes the popover selection directly', async () => {
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
	await actions.click( await screen.findByRole( 'button', { name: /^(Share|Publish)…$/ } ) );
	await actions.click( await screen.findByRole( 'button', { name: 'What to publish' } ) );
	expect( await screen.findByRole( 'checkbox', { name: 'Themes' } ) ).toBeChecked();
	expect( screen.getAllByRole( 'checkbox' ) ).toHaveLength( 5 );
	expect( screen.getByRole( 'heading', { name: 'Publish' } ) ).toBeVisible();
	const warning = /Publishing the database replaces anything/;
	expect( screen.getByText( warning ) ).toBeVisible();
	await actions.click( screen.getByRole( 'checkbox', { name: /Database/ } ) );
	expect( screen.queryByText( warning ) ).not.toBeInTheDocument();
	expect( screen.getByRole( 'button', { name: 'What to publish' } ) ).toHaveAccessibleDescription(
		'Files only'
	);
	const everything = screen.getByRole( 'checkbox', { name: 'Everything' } );
	expect( everything ).toBePartiallyChecked();
	expect( everything.querySelector( '.lucide-minus' ) ).toBeInTheDocument();
	await actions.click( everything );
	for ( const checkbox of screen.getAllByRole( 'checkbox' ) ) expect( checkbox ).toBeChecked();
	expect( screen.getByText( warning ) ).toBeVisible();
	expect( everything ).not.toHaveAttribute( 'aria-disabled', 'true' );
	await actions.click( everything );
	for ( const checkbox of screen.getAllByRole( 'checkbox' ) ) expect( checkbox ).toBeChecked();
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
	await actions.click( screen.getByRole( 'heading', { name: 'Publish' } ) );
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
	expect( screen.getByRole( 'heading', { name: 'Publish' } ) ).toBeVisible();
	expect( screen.getByRole( 'button', { name: 'What to publish' } ) ).toHaveFocus();
	const publish = screen.getByRole( 'button', { name: 'Publish changes' } );
	await waitFor( () => expect( publish ).toBeEnabled() );
	await actions.click( publish );
	await waitFor( () =>
		expect( connector.pushSite ).toHaveBeenCalledWith( 'wpcom', connector.state.sites[ 0 ].id, 42, {
			optionsToSync: [ 'plugins', 'themes' ],
			specificSelectionPaths: [ 'plugins', 'themes' ],
		} )
	);
} );

it( 'opens the preview from its URL row and copies from the main button', async () => {
	const connector = setup();
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
	await actions.click( await screen.findByRole( 'button', { name: /^(Share|Publish)…$/ } ) );
	const panel = await screen.findByRole( 'dialog', { name: /^(Share|Publish)$/ } );
	expect( within( panel ).getByText( /Expires / ) ).toBeVisible();
	expect( within( panel ).getByRole( 'button', { name: 'Learn more' } ) ).toBeVisible();
	await copyPreviewLink( actions );
	expect( connector.copyText ).toHaveBeenCalledWith( 'https://copy.example.com/?share=test' );
	expect( connector.openExternalUrl ).not.toHaveBeenCalled();
	const row = screen.getByRole( 'button', { name: 'Open preview: Preview 1' } );
	expect( row.querySelectorAll( 'svg' ) ).toHaveLength( 2 );
	await actions.click( within( row ).getByText( /Expires / ) );
	expect( connector.openExternalUrl ).toHaveBeenLastCalledWith(
		'https://copy.example.com/?share=test'
	);
	await actions.click( within( row ).getByText( 'Preview 1' ) );
	await actions.click( row );
	row.focus();
	await actions.keyboard( '{Enter}' );
	expect( connector.openExternalUrl ).toHaveBeenCalledTimes( 4 );
	await actions.click( within( panel ).getByRole( 'button', { name: 'Learn more' } ) );
	expect( connector.openExternalUrl ).toHaveBeenLastCalledWith(
		'https://wordpress.studio/docs/preview-sites/'
	);
	expect( getVisibleToasts().some( ( item ) => item.id === 'clipboard-success' ) ).toBe( false );

	expect( screen.queryByRole( 'button', { name: 'Copy preview link' } ) ).not.toBeInTheDocument();
} );

it( 'offers publishing help inline in the description before a preview exists', async () => {
	const connector = setup();
	const actions = userEvent.setup();
	await actions.click( await screen.findByRole( 'button', { name: /^(Share|Publish)…$/ } ) );
	const panel = await screen.findByRole( 'dialog', { name: /^(Share|Publish)$/ } );
	expect(
		within( panel ).queryByRole( 'button', { name: 'Copy preview link' } )
	).not.toBeInTheDocument();
	const help = within( panel ).getByRole( 'button', { name: 'Learn more' } );
	expect( help.closest( 'p' ) ).toHaveTextContent(
		'Share a temporary preview, or make your WordPress public.'
	);
	expect( help ).toHaveAttribute( 'data-variant', 'inline-accent' );
	await actions.click( help );
	expect( connector.openExternalUrl ).toHaveBeenCalledWith( 'https://wordpress.studio/docs/sync/' );
	expect( connector.publishPreviewSite ).not.toHaveBeenCalled();
} );

it( 'keeps the heading consistent without a status badge when sharing a preview', async () => {
	const connector = setup();
	const actions = userEvent.setup();
	await actions.click( await screen.findByRole( 'button', { name: /^(Share|Publish)…$/ } ) );
	expect( screen.getByRole( 'heading', { name: /^(Share|Publish)$/ } ) ).toBeVisible();
	expect( screen.queryByRole( 'status', { name: 'Publishing status' } ) ).not.toBeInTheDocument();
	await waitFor( () =>
		expect( screen.getByRole( 'button', { name: 'Create preview link' } ) ).toBeEnabled()
	);
	await actions.click( screen.getByRole( 'button', { name: 'Create preview link' } ) );
	await waitFor( () => expect( connector.publishPreviewSite ).toHaveBeenCalledOnce() );
	expect( screen.queryByRole( 'status', { name: 'Publishing status' } ) ).not.toBeInTheDocument();
	expect( screen.queryByText( 'Not published' ) ).not.toBeInTheDocument();
	await waitFor( () =>
		expect( screen.getByRole( 'button', { name: 'More options' } ) ).toBeEnabled()
	);

	expect( screen.queryByRole( 'status', { name: 'Publishing status' } ) ).not.toBeInTheDocument();
	expect( screen.queryByText( 'Published', { exact: true } ) ).not.toBeInTheDocument();
} );

it.each( [
	{ isStaging: false, launchStatus: 'unlaunched', expected: 'Only you' },
	{ isStaging: false, launchStatus: 'launched', expected: 'Everyone' },
	{ isStaging: false, launchStatus: undefined, expected: 'Unknown' },
	{ isStaging: true, launchStatus: 'launched', expected: 'Everyone' },
	{ isStaging: false, launchStatus: 'launched', isComingSoon: true, expected: 'Only you' },
	{ isStaging: false, launchStatus: 'launched', isPrivate: true, expected: 'Invited people' },
] )(
	'shows Unknown instead of stored visibility while refreshing: $expected',
	async ( { isStaging, launchStatus, isComingSoon, isPrivate } ) => {
		const connector = setup();
		connector.getSiteVisibility.mockImplementation( () => new Promise( () => {} ) );
		connector.getRemoteSites.mockResolvedValue( [
			{
				id: 42,
				localSiteId: connector.state.sites[ 0 ].id,
				name: 'Remote site',
				url: 'https://published.example.com',
				isStaging,
				launchStatus,
				isComingSoon,
				isPrivate,
				isPressable: false,
				syncSupport: 'syncable',
				lastPullTimestamp: null,
				lastPushTimestamp: null,
			},
		] );
		const actions = userEvent.setup();
		await actions.click( await screen.findByRole( 'button', { name: /^(Share|Publish)…$/ } ) );
		expect(
			await screen.findByRole( 'button', { name: 'Who can view' } )
		).toHaveAccessibleDescription( 'Unknown' );
		expect( screen.queryByRole( 'status', { name: 'Publishing status' } ) ).not.toBeInTheDocument();
		expect( screen.queryByText( 'Not published' ) ).not.toBeInTheDocument();
	}
);

it( 'copies an up-to-date preview link from the main button', async () => {
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
	await actions.click( await screen.findByRole( 'button', { name: /^(Share|Publish)…$/ } ) );
	expect(
		await screen.findByText( /Anyone with the link can view this preview until it expires\./ )
	).toBeVisible();
	expect( screen.getByRole( 'button', { name: 'Learn more' } ) ).toBeVisible();
	const view = await screen.findByRole( 'button', { name: 'Copy link' } );
	expect( screen.queryByRole( 'button', { name: 'Update preview' } ) ).not.toBeInTheDocument();
	await actions.click( view );
	expect( connector.copyText ).toHaveBeenCalledWith( 'https://footer.example.com' );
	expect( connector.publishPreviewSite ).not.toHaveBeenCalled();
} );

it( 'keeps a full-width preview update action and acknowledges the changes dot', async () => {
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
	const share = await screen.findByRole( 'button', { name: /^(Share|Publish)…$/ } );
	await waitFor( () => expect( share.querySelector( '[data-pulse]' ) ).toBeInTheDocument() );
	await actions.click( share );
	expect(
		screen.getByText( /Anyone with the link can view this preview until it expires\./ )
	).toBeVisible();
	expect( screen.getByRole( 'heading', { name: /^(Share|Publish)$/ } ) ).toBeVisible();
	expect( screen.queryByRole( 'status', { name: 'Publishing status' } ) ).not.toBeInTheDocument();
	expect( screen.queryByText( 'Local changes to share' ) ).not.toBeInTheDocument();
	expect(
		screen.getByRole( 'button', {
			name: 'Update preview',
		} )
	).toBeVisible();
	expect( screen.queryByRole( 'button', { name: 'Copy preview link' } ) ).not.toBeInTheDocument();
	expect( screen.queryByRole( 'button', { name: 'What to publish' } ) ).not.toBeInTheDocument();
	expect( share.querySelector( '[data-pulse]' ) ).not.toBeInTheDocument();
	await actions.click( screen.getByRole( 'button', { name: 'Update preview' } ) );
	expect( await screen.findByRole( 'button', { name: 'Updating preview…' } ) ).toHaveAttribute(
		'aria-busy',
		'true'
	);
	expect(
		screen.getByText( 'Anyone with the link can view this preview until it expires.' )
	).toBeVisible();
	await waitFor( () => expect( connector.publishPreviewSite ).toHaveBeenCalledTimes( 1 ) );
	await act( async () => finish() );
	expect(
		await screen.findByText( 'Anyone with the link can view this preview until it expires.' )
	).toBeVisible();
	expect( await screen.findByRole( 'button', { name: 'Copy link' } ) ).not.toHaveAttribute(
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
	await actions.click( await screen.findByRole( 'button', { name: /^(Share|Publish)…$/ } ) );
	expect( await screen.findByText( 'lentestarter.blog', { exact: true } ) ).toBeVisible();
	expect( screen.getByRole( 'button', { name: 'Who can view' } ) ).toHaveTextContent( 'Only you' );
	expect( screen.queryByRole( 'button', { name: 'Copy preview link' } ) ).not.toBeInTheDocument();
	await actions.keyboard( '{Escape}' );
	await waitFor( () =>
		expect( screen.queryByRole( 'dialog', { name: /^(Share|Publish)$/ } ) ).not.toBeInTheDocument()
	);
	connector.getSiteVisibility.mockResolvedValue( {
		visibility: 'public',
		url: 'https://new-address.blog',
		launchStatus: 'launched',
	} );
	connector.listAccountSites.mockResolvedValue( [
		{ ...remote, url: 'https://new-address.blog', launchStatus: 'launched' },
	] );
	await actions.click( screen.getByRole( 'button', { name: /^(Share|Publish)…$/ } ) );
	expect( await screen.findByText( 'new-address.blog', { exact: true } ) ).toBeVisible();
	expect( screen.getByRole( 'button', { name: 'Who can view' } ) ).toHaveTextContent( 'Everyone' );
	expect( connector.pushSite ).not.toHaveBeenCalled();
	expect( connector.publishPreviewSite ).not.toHaveBeenCalled();
	expect( connector.openExternalUrl ).not.toHaveBeenCalled();
	await actions.click( screen.getByRole( 'button', { name: 'new-address.blog' } ) );
	await waitFor( () =>
		expect( connector.openExternalUrl ).toHaveBeenCalledWith( 'https://new-address.blog' )
	);
	expect( screen.queryByRole( 'button', { name: 'Manage domain' } ) ).not.toBeInTheDocument();
	expect( screen.queryByRole( 'button', { name: 'Add a domain' } ) ).not.toBeInTheDocument();
	expect( screen.getByRole( 'button', { name: 'Who can view' } ) ).toHaveAttribute(
		'aria-description',
		'Everyone'
	);
	await actions.click( screen.getByRole( 'button', { name: 'Who can view' } ) );
	expect( await screen.findByRole( 'menuitemradio', { name: 'Everyone' } ) ).toBeChecked();
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
		await actions.click( await screen.findByRole( 'button', { name: /^(Share|Publish)…$/ } ) );
		await actions.click( await screen.findByRole( 'button', { name: 'Who can view' } ) );
		const next = initial === 'public' ? 'coming-soon' : 'public';
		await actions.click(
			await screen.findByRole( 'menuitemradio', {
				name: next === 'public' ? 'Everyone' : 'Only you',
			} )
		);
		await waitFor( () =>
			expect( connector.setSiteVisibility ).toHaveBeenCalledExactlyOnceWith( 'wpcom', 42, next )
		);
		await waitFor( () => expect( screen.queryByRole( 'menu' ) ).not.toBeInTheDocument() );
		expect( screen.getByRole( 'heading', { name: 'Publish' } ) ).toBeVisible();
		expect( screen.getByRole( 'button', { name: 'Who can view' } ) ).toHaveAccessibleDescription(
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
	await actions.click( screen.getByRole( 'button', { name: 'Who can view' } ) );
	await screen.findByRole( 'menuitemradio', { name: 'Only you' } );
	await actions.keyboard( '{Escape}' );
	expect( screen.queryByRole( 'menu' ) ).not.toBeInTheDocument();
	expect( screen.getByRole( 'heading', { name: 'Publish' } ) ).toBeVisible();
	expect( connector.setSiteVisibility ).not.toHaveBeenCalled();
} );

it( 'keeps the current visibility checked after a failed save and permits retry', async () => {
	const connector = setupHostedVisibility( 'public', true );
	const actions = userEvent.setup();
	await actions.click( await screen.findByRole( 'button', { name: 'Publish…' } ) );
	await actions.click( screen.getByRole( 'button', { name: 'Who can view' } ) );
	await actions.click( await screen.findByRole( 'menuitemradio', { name: 'Only you' } ) );
	expect( await screen.findByRole( 'alert' ) ).toHaveTextContent( 'Could not save visibility' );
	expect( screen.getByRole( 'menuitemradio', { name: 'Everyone' } ) ).toBeChecked();
	expect( screen.getByRole( 'menuitemradio', { name: 'Only you' } ) ).not.toBeChecked();
	connector.setSiteVisibility.mockResolvedValue( {
		visibility: 'coming-soon',
		url: 'https://hosted.blog',
		launchStatus: 'launched',
	} );
	await actions.click( screen.getByRole( 'menuitemradio', { name: 'Only you' } ) );
	await waitFor( () => expect( screen.queryByRole( 'menu' ) ).not.toBeInTheDocument() );
	expect( screen.getByRole( 'button', { name: 'Who can view' } ) ).toHaveAccessibleDescription(
		'Only you'
	);
} );

it( 'shows people-based visibility options with descriptions and the current checkmark', async () => {
	const connector = setupHostedVisibility();
	const actions = userEvent.setup();
	await actions.click( await screen.findByRole( 'button', { name: 'Publish…' } ) );
	await actions.click( screen.getByRole( 'button', { name: 'Who can view' } ) );
	const options = await screen.findAllByRole( 'menuitemradio' );
	expect( options ).toHaveLength( 2 );
	expect( options[ 0 ] ).toHaveAccessibleName( 'Only you' );
	expect( options[ 1 ] ).toHaveAccessibleName( 'Everyone' );
	expect( options[ 1 ] ).toBeChecked();
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
			name: connected ? 'Publish…' : 'Share…',
		} );
		expect( button ).toHaveTextContent( connected ? 'Publish' : 'Share' );
		expect( button.querySelector( 'svg' ) ).toBeInTheDocument();
		await actions.hover( button );
		expect(
			await screen.findByText(
				connected ? 'Publish changes to current-domain.blog' : 'Share a preview or make it public'
			)
		).toBeVisible();
		expect( screen.queryByRole( 'dialog', { name: /^(Share|Publish)$/ } ) ).not.toBeInTheDocument();
		await actions.click( button );
		const panel = await screen.findByRole( 'dialog', {
			name: connected ? 'Publish' : 'Share',
		} );
		expect(
			within( panel ).getByRole( 'heading', { name: connected ? 'Publish' : 'Share' } )
		).toBeVisible();
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
		expect( await screen.findByText( 'Published 2 hours ago' ) ).toBeVisible();
		if ( localChanged !== null ) {
			expect(
				await screen.findByText(
					localChanged ? "You have changes that aren't live yet." : 'Your latest changes are live.'
				)
			).toBeVisible();
		} else {
			expect( await screen.findByText( "You have changes that aren't live yet." ) ).toBeVisible();
			expect( screen.queryByText( 'Your latest changes are live.' ) ).not.toBeInTheDocument();
		}
		expect( !! screen.queryByRole( 'img', { name: 'Local changes' } ) ).toBe(
			localChanged === true
		);
		if ( localChanged === false ) {
			await actions.click( await screen.findByRole( 'button', { name: 'Copy link' } ) );
			await waitFor( () =>
				expect( connector.copyText ).toHaveBeenCalledWith( 'https://actual.blog/' )
			);
			expect( screen.queryByRole( 'button', { name: 'Publish changes' } ) ).not.toBeInTheDocument();
		} else {
			expect( await screen.findByRole( 'button', { name: 'Publish changes' } ) ).toBeVisible();
		}
		await actions.click( screen.getByRole( 'button', { name: 'More options' } ) );
		expect(
			( await screen.findAllByRole( 'menuitem' ) ).map( ( item ) => item.textContent?.trim() )
		).toEqual( [
			'New preview',
			'WordPress admin',
			'Domains',
			'Backups',
			'Pull from live site',
			'Connect existing site',
			'Disconnect site',
		] );
		expect( connector.pushSite ).not.toHaveBeenCalled();
	}
);

it( 'offers provider settings instead of a dead-end retry when visibility API access is blocked', async () => {
	const connector = setupHostedVisibility();
	connector.getSiteVisibility.mockRejectedValue(
		new Error( 'API calls to this blog have been disabled.' )
	);
	const actions = userEvent.setup();
	await actions.click( await screen.findByRole( 'button', { name: /^(Share|Publish)…$/ } ) );
	await actions.click( screen.getByRole( 'button', { name: 'Who can view' } ) );
	for ( const option of await screen.findAllByRole( 'menuitemradio' ) )
		expect( option ).toHaveAttribute( 'aria-disabled', 'true' );
	expect( screen.queryByRole( 'button', { name: 'Try again' } ) ).not.toBeInTheDocument();
	expect( screen.getByRole( 'button', { name: 'Who can view' } ) ).toHaveAccessibleDescription(
		'Unknown'
	);
	await actions.click( screen.getByRole( 'menuitem', { name: 'Manage on WordPress.com' } ) );
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
	await actions.click( await screen.findByRole( 'button', { name: /^(Share|Publish)…$/ } ) );
	expect(
		await screen.findByRole( 'button', { name: 'Who can view' } )
	).toHaveAccessibleDescription( 'Unknown' );
	await actions.click( screen.getByRole( 'button', { name: 'Who can view' } ) );
	expect(
		await screen.findByRole( 'menuitem', { name: 'Manage on WordPress.com' } )
	).toBeVisible();
	await act( async () => finish() );
	await waitFor( () =>
		expect( screen.getByRole( 'button', { name: 'Who can view' } ) ).toHaveAccessibleDescription(
			'Everyone'
		)
	);
	expect( screen.getByRole( 'menuitemradio', { name: 'Everyone', checked: true } ) ).toBeVisible();
	expect( screen.getByRole( 'menuitem', { name: 'Manage on WordPress.com' } ) ).toBeVisible();
} );
