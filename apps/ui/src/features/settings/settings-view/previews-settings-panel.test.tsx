import { DAY_MS } from '@studio/common/constants';
import { SNAPSHOT_EVENTS } from '@studio/common/lib/cli-events';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { expect, it } from 'vitest';
import { ShareButton } from '@/features/sharing';
import { createFakeConnector, makeSite } from '@/test/fake-connector';
import { renderWithProviders } from '@/test/render';
import { SharingPanel } from './sharing-panel';
import type { Snapshot } from '@/data/core';

function setup( showShare = false, initialSnapshots?: Snapshot[] ) {
	const snapshots: Snapshot[] = initialSnapshots ?? [
		{
			atomicSiteId: 1,
			localSiteId: 'one',
			userId: 1,
			name: 'First site',
			url: 'one.example.com',
			date: Date.now(),
		},
		{
			atomicSiteId: 2,
			localSiteId: 'two',
			userId: 1,
			name: 'Second site',
			url: 'two.example.com',
			date: Date.now() - 8 * DAY_MS,
		},
		{
			atomicSiteId: 3,
			localSiteId: 'one',
			userId: 2,
			url: 'private.example.com',
			date: Date.now(),
		},
	];
	const connector = createFakeConnector(
		{},
		{
			getSnapshots: async () => snapshots,
			getSnapshotUsage: async () => ( { siteCount: 10, siteLimit: 10 } ) as never,
			publishPreviewSite: async () => ( { url: 'https://one.example.com' } ),
		}
	);
	renderWithProviders(
		<>
			<div data-testid="settings-previews">
				<SharingPanel />
			</div>
			{ showShare ? <ShareButton site={ makeSite( { id: 'one', name: 'First site' } ) } /> : null }
		</>,
		{ connector }
	);
	return { connector };
}

it( 'lists previews across sites, excludes other accounts and counts only unexpired links', async () => {
	const { connector } = setup();
	expect( await screen.findByText( '1 of 10 preview sites used' ) ).toBeVisible();
	const live = screen.getByRole( 'group', { name: 'Live previews' } );
	expect( live ).toBeVisible();
	expect( screen.queryByText( 'two.example.com' ) ).not.toBeInTheDocument();
	const disclosure = screen.getByRole( 'button', { name: 'Show expired previews (1)' } );
	expect( disclosure ).toHaveAttribute( 'aria-expanded', 'false' );
	fireEvent.click( disclosure );
	expect( await screen.findByRole( 'group', { name: 'Expired previews' } ) ).toBeVisible();
	expect( screen.getByText( 'two.example.com' ) ).toBeVisible();
	expect( screen.getByText( 'Expired' ) ).toBeVisible();
	expect( screen.getByText( /^Expires / ) ).toBeVisible();
	expect( screen.queryByText( 'private.example.com' ) ).not.toBeInTheDocument();
	expect( connector.getSnapshotUsage ).toHaveBeenCalled();
	fireEvent.click( within( live ).getByRole( 'button', { name: 'Copy link' } ) );
	await waitFor( () =>
		expect( connector.copyText ).toHaveBeenCalledWith( 'https://one.example.com' )
	);
	const link = screen.getByRole( 'button', { name: 'one.example.com' } );
	expect( screen.queryByRole( 'button', { name: 'Open' } ) ).not.toBeInTheDocument();
	expect( screen.queryByRole( 'button', { name: 'two.example.com' } ) ).not.toBeInTheDocument();
	fireEvent.click( link );
	expect( connector.openExternalUrl ).toHaveBeenCalledWith( 'https://one.example.com' );
	expect( screen.queryByRole( 'button', { name: 'Delete all' } ) ).not.toBeInTheDocument();
	expect( connector.deleteAllSnapshots ).not.toHaveBeenCalled();
} );

it( 'refreshes the shared settings and Share list together after a preview changes', async () => {
	const { connector } = setup( true );
	fireEvent.click( await screen.findByRole( 'button', { name: 'Share' } ) );
	await waitFor( () => expect( screen.getAllByText( 'First site' ) ).toHaveLength( 1 ) );
	const share = within( screen.getByRole( 'dialog', { name: 'Share' } ) );
	expect( share.queryByText( 'two.example.com' ) ).not.toBeInTheDocument();
	act( () =>
		connector.emit( 'onSnapshotEvent', {
			event: SNAPSHOT_EVENTS.UPDATED,
			snapshotUrl: 'one.example.com',
			snapshot: {
				atomicSiteId: 1,
				localSiteId: 'one',
				userId: 1,
				name: 'Renamed preview',
				url: 'changed.example.com',
				date: Date.now(),
			},
		} )
	);
	await waitFor( () => expect( screen.getAllByText( 'Renamed preview' ) ).toHaveLength( 1 ) );
	expect( screen.queryByText( 'one.example.com' ) ).not.toBeInTheDocument();
	act( () => connector.emit( 'onSnapshotEvent', { event: SNAPSHOT_EVENTS.DELETED_ALL } ) );
	expect( await share.findByRole( 'button', { name: 'Create preview' } ) ).toBeVisible();
	expect(
		within( screen.getByTestId( 'settings-previews' ) ).getByText( 'Share a preview of your site' )
	).toBeInTheDocument();
} );

it( 'keeps the introduction above a sharing fieldset without empty usage or list controls', async () => {
	setup( false, [] );
	const guide = await screen.findByText( 'Share a preview of your site' );
	expect( guide ).toBeVisible();
	const introduction = screen.getByText( 'Sharing previews on WordPress.com' );
	expect( introduction ).toBeVisible();
	expect( screen.getByRole( 'button', { name: 'Learn more…' } ) ).toBeVisible();
	expect(
		introduction.compareDocumentPosition( guide ) & Node.DOCUMENT_POSITION_FOLLOWING
	).toBeTruthy();
	expect(
		screen.getByText(
			'Start a site and click Share in the top right. Copy the preview link to share your work with anyone.'
		)
	).toBeVisible();
	expect( screen.queryByText( /preview sites used/ ) ).not.toBeInTheDocument();
	expect( screen.queryByRole( 'button', { name: 'Delete all' } ) ).not.toBeInTheDocument();
	expect( screen.queryByRole( 'group', { name: 'Live previews' } ) ).not.toBeInTheDocument();
} );

it( 'keeps expired previews accessible alongside the sharing guide', async () => {
	setup( false, [
		{
			atomicSiteId: 1,
			localSiteId: 'one',
			userId: 1,
			name: 'Expired site',
			url: 'expired.example.com',
			date: Date.now() - 8 * DAY_MS,
		},
	] );
	expect( await screen.findByText( 'Share a preview of your site' ) ).toBeVisible();
	expect( screen.queryByText( /preview sites used/ ) ).not.toBeInTheDocument();
	expect( screen.queryByRole( 'group', { name: 'Live previews' } ) ).not.toBeInTheDocument();
	fireEvent.click( screen.getByRole( 'button', { name: 'Show expired previews (1)' } ) );
	expect( screen.getByText( 'expired.example.com' ) ).toBeVisible();
	expect( screen.getByRole( 'button', { name: 'Remove expired preview' } ) ).toBeVisible();
} );

it( 'confirms individual preview deletion before calling the backend', async () => {
	const { connector } = setup();
	await screen.findByText( '1 of 10 preview sites used' );
	fireEvent.click( screen.getByRole( 'button', { name: 'Delete preview' } ) );
	expect( connector.deleteSnapshot ).not.toHaveBeenCalled();
	const dialog = await screen.findByRole( 'alertdialog', { name: 'Delete preview' } );
	expect(
		within( dialog ).getByText(
			'Are you sure you want to remove the preview for “First site” from WordPress Studio?'
		)
	).toBeVisible();
	expect(
		within( dialog ).getByText(
			'Anyone you’ve shared this preview with will no longer be able to view it. Your site will not be deleted.'
		)
	).toBeVisible();
	fireEvent.click( within( dialog ).getByRole( 'button', { name: 'Delete preview' } ) );
	await waitFor( () =>
		expect( connector.deleteSnapshot ).toHaveBeenCalledWith( 'one.example.com' )
	);
	await waitFor( () =>
		expect(
			screen.queryByRole( 'alertdialog', { name: 'Delete preview' } )
		).not.toBeInTheDocument()
	);
} );
