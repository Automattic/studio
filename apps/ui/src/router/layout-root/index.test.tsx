import { act, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { createFakeConnector, makeSession, makeSite } from '@/test/fake-connector';
import { renderApp } from '@/test/render';
import type { SiteDetails } from '@/data/core';

const deletedSite = makeSite( {
	id: 'deleted-site',
	name: 'Deleted Site',
	path: '/sites/deleted',
} );
const otherSite = makeSite( { id: 'other-site', name: 'Other Site', path: '/sites/other' } );

const chat = ( id: string, owner: SiteDetails ) => ( {
	summary: makeSession( { id, ownerSitePath: owner.path } ),
	entries: [],
} );

async function setup( path: string ) {
	const connector = createFakeConnector( {
		sites: [ deletedSite, otherSite ],
		sessions: [ chat( 'doomed-session', deletedSite ), chat( 'safe-session', otherSite ) ],
	} );
	const view = renderApp( { connector, path } );
	await waitFor( () => expect( connector.listenerCount( 'onSiteEvent' ) ).toBeGreaterThan( 0 ) );
	await waitFor( () => expect( connector.getSessions ).toHaveBeenCalled() );
	return view;
}

describe( 'DeletedSiteRedirect', () => {
	it.each( [
		[ 'the open chat belongs to', '/sessions/doomed-session' ],
		[ 'the open route is', '/sites/deleted-site' ],
	] )( 'leaves the route when %s a site deleted outside the app', async ( _, path ) => {
		const { connector, history } = await setup( path );
		await act( () => connector.deleteSite( deletedSite.id ) );
		await waitFor( () => expect( history.location.pathname ).not.toBe( path ) );
		expect( history.location.pathname ).not.toContain( deletedSite.id );
	} );

	it( 'stays put when the open chat belongs to another site', async () => {
		const { connector, history } = await setup( '/sessions/safe-session' );
		expect( await screen.findByText( 'Deleted Site' ) ).toBeInTheDocument();
		await act( () => connector.deleteSite( deletedSite.id ) );
		await waitFor( () => expect( screen.queryByText( 'Deleted Site' ) ).not.toBeInTheDocument() );
		expect( history.location.pathname ).toBe( '/sessions/safe-session' );
	} );

	it( 'ignores site events that are not deletions', async () => {
		const { connector, history } = await setup( '/sessions/doomed-session' );
		await act( () => connector.updateSite( { ...deletedSite, name: 'Renamed' } ) );
		expect( await screen.findByRole( 'button', { name: 'Renamed' } ) ).toBeInTheDocument();
		expect( history.location.pathname ).toBe( '/sessions/doomed-session' );
	} );
} );
