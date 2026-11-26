import { act, screen, waitFor, within } from '@testing-library/react';
import { expect, it } from 'vitest';
import { createFakeConnector, makeSite } from '@/test/fake-connector';
import { renderApp } from '@/test/render';
import type { PreviewStatus, SyncSite } from '@/data/core/types';

const remote = ( id: number, localSiteId = '' ): SyncSite => ( {
	id,
	localSiteId,
	name: `Remote ${ id }`,
	url: `https://remote-${ id }.example.com`,
	isStaging: false,
	isPressable: false,
	syncSupport: 'syncable',
	lastPullTimestamp: null,
	lastPushTimestamp: null,
} );

const preview = {
	url: 'preview-42.wpcomstaging.com',
	atomicSiteId: 42,
	localSiteId: 'one',
	date: 1000,
};

function setup( {
	connected = [] as SyncSite[],
	syncable = [] as SyncSite[],
	snapshots = [] as ( typeof preview )[],
	status = { localSiteId: 'one', localChanged: false, previewChanged: false } as PreviewStatus,
} = {} ) {
	const connector = createFakeConnector(
		{ sites: [ makeSite( { id: 'one', name: 'First site' } ) ] },
		{
			getRemoteSites: async () => connected,
			listAccountSites: async () => syncable,
			getSnapshots: async () => snapshots,
			getPreviewStatus: async () => status,
		}
	);
	return { ...renderApp( { connector, path: '/sites/one/new' } ), connector };
}

it( "confirms before pulling from the link's remote site", async () => {
	const { connector, history, user } = setup( {
		connected: [ remote( 42, 'one' ) ],
		syncable: [ remote( 42 ) ],
	} );
	await screen.findByRole( 'button', { name: 'First site' } );
	act( () => connector.emit( 'onPullSite', { remoteSiteId: 42 } ) );
	const dialog = await screen.findByRole( 'alertdialog', {
		name: 'Update local site from remote-42.example.com?',
	} );
	expect( history.location.pathname ).toBe( '/sites/one/new' );
	expect( connector.pullSite ).not.toHaveBeenCalled();
	const pull = within( dialog ).getByRole( 'button', { name: 'Replace selected content' } );
	await waitFor( () => expect( pull ).toBeEnabled() );
	await user.click( pull );
	await waitFor( () =>
		expect( connector.pullSite ).toHaveBeenCalledWith( 'wpcom', 'one', 42, expect.anything() )
	);
} );

it( 'sets up a new local site for a remote site no local site is connected to', async () => {
	const { connector } = setup( { syncable: [ remote( 41 ), remote( 42 ) ] } );
	await screen.findByRole( 'button', { name: 'First site' } );
	act( () => connector.emit( 'onPullSite', { remoteSiteId: 42 } ) );
	expect( await screen.findByText( 'https://remote-42.example.com' ) ).toBeVisible();
	expect( connector.createSite ).not.toHaveBeenCalled();
} );

it( "explains a link to a site the user can't pull", async () => {
	const { connector } = setup( { syncable: [ remote( 42 ) ] } );
	await screen.findByRole( 'button', { name: 'First site' } );
	act( () => connector.emit( 'onPullSite', { remoteSiteId: 7 } ) );
	await screen.findByText( "This site isn't one of your WordPress.com or Pressable sites." );
} );

it.each( [
	[ 'opens the site when neither side changed', false, false, null ],
	[ 'offers to update the preview when only the site changed', true, false, 'Update preview' ],
	[ 'pulls the preview when only the preview changed', false, true, null ],
	[ 'asks before pulling when both changed', true, true, 'Pull preview' ],
] )(
	'%s, for a preview the site was synced with',
	async ( _, localChanged, previewChanged, button ) => {
		const { connector, history } = setup( {
			snapshots: [ preview ],
			status: { localSiteId: 'one', localChanged, previewChanged },
		} );
		await screen.findByRole( 'button', { name: 'First site' } );
		act( () => connector.emit( 'onPullSite', { remoteSiteId: 42 } ) );
		await waitFor( () =>
			expect( connector.getPreviewStatus ).toHaveBeenCalledWith( 'preview-42.wpcomstaging.com' )
		);
		if ( button ) {
			expect( await screen.findByRole( 'button', { name: button } ) ).toBeVisible();
		}
		expect( history.location.pathname ).toBe( '/sites/one/new' );
		if ( previewChanged && ! localChanged ) {
			await waitFor( () =>
				expect( connector.pullSite ).toHaveBeenCalledWith( 'wpcom', 'one', 42, undefined )
			);
		} else {
			expect( connector.pullSite ).not.toHaveBeenCalled();
		}
		expect( connector.publishPreviewSite ).not.toHaveBeenCalled();
	}
);
