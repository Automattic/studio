import { act, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { createFakeConnector, makeSite } from '@/test/fake-connector';
import { renderApp } from '@/test/render';
import type { SyncSite } from '@/data/core';

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

function setup( { connected = [] as SyncSite[], syncable = [] as SyncSite[] } = {} ) {
	const connector = createFakeConnector(
		{ sites: [ makeSite( { id: 'one', name: 'First site' } ) ] },
		{
			getConnectedWpcomSites: async () => connected,
			fetchSyncableWpcomSites: async () => syncable,
		}
	);
	return { ...renderApp( { connector, path: '/sites/one/new' } ), connector };
}

it( "opens the Pull view of the site connected to the link's remote site", async () => {
	const { connector, history } = setup( { connected: [ remote( 42, 'one' ) ] } );
	await screen.findByRole( 'button', { name: 'First site' } );
	act( () => connector.emit( 'onPullSite', { remoteSiteId: 42 } ) );
	expect( await screen.findByRole( 'button', { name: 'Pull changes' } ) ).toBeVisible();
	expect( history.location.pathname ).toBe( '/sites/one/new' );
	expect( connector.pullSiteFromLive ).not.toHaveBeenCalled();
} );

it( 'sets up a new local site for a remote site no local site is connected to', async () => {
	const { connector } = setup( { syncable: [ remote( 41 ), remote( 42 ) ] } );
	await screen.findByRole( 'button', { name: 'First site' } );
	act( () => connector.emit( 'onPullSite', { remoteSiteId: 42 } ) );
	expect( await screen.findByText( 'remote-42.example.com' ) ).toBeVisible();
	expect( connector.createSite ).not.toHaveBeenCalled();
} );

it( "explains a link to a site the user can't pull", async () => {
	const { connector } = setup( { syncable: [ remote( 42 ) ] } );
	await screen.findByRole( 'button', { name: 'First site' } );
	act( () => connector.emit( 'onPullSite', { remoteSiteId: 7 } ) );
	await screen.findByText( "This site isn't one of your WordPress.com or Pressable sites." );
} );
