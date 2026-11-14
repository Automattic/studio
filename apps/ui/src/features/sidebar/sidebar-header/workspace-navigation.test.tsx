import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { SESSIONS_QUERY_KEY } from '@/data/queries/use-sessions';
import { SITES_QUERY_KEY } from '@/data/queries/use-sites';
import { createFakeConnector, makeSession, makeSite } from '@/test/fake-connector';
import { renderApp } from '@/test/render';
import type { RouterHistory } from '@tanstack/react-router';

const sites = [
	makeSite( { id: 'one', name: 'First site' } ),
	makeSite( { id: 'two', name: 'Second site' } ),
];
const sessions = [
	{
		summary: makeSession( { id: 'first', title: 'First chat', ownerSiteId: 'one' } ),
		entries: [],
	},
];

async function setup() {
	const view = renderApp( {
		connector: createFakeConnector( { sites, sessions } ),
		path: '/sites/one',
	} );
	await screen.findByRole( 'button', { name: 'First site' } );
	return view;
}

const navigation = () => within( screen.getByRole( 'group', { name: 'Workspace navigation' } ) );
const back = () => navigation().getByRole( 'button', { name: 'Back' } );
const forward = () => navigation().getByRole( 'button', { name: 'Forward' } );

async function visit( history: RouterHistory, path: string ) {
	await act( () => history.push( path ) );
}

beforeEach( () => localStorage.clear() );

describe( 'workspace navigation', () => {
	it( 'hides empty history and navigates between sites', async () => {
		const { history } = await setup();
		expect(
			screen.queryByRole( 'group', { name: 'Workspace navigation' } )
		).not.toBeInTheDocument();
		fireEvent.click( screen.getByRole( 'button', { name: 'Second site' } ) );
		await waitFor( () => expect( history.location.pathname ).toBe( '/sites/two/new' ) );
		expect( back() ).not.toHaveAttribute( 'aria-disabled', 'true' );
		fireEvent.click( back() );
		await waitFor( () => expect( history.location.pathname ).toBe( '/sites/one' ) );
		expect( back() ).toHaveAttribute( 'aria-disabled', 'true' );
		fireEvent.click( forward() );
		await waitFor( () => expect( history.location.pathname ).toBe( '/sites/two/new' ) );
		expect( forward() ).toHaveAttribute( 'aria-disabled', 'true' );
	} );

	it( 'returns to chats and skips dismissed dialogs and repeated locations', async () => {
		const { history } = await setup();
		await visit( history, '/sessions/first' );
		await visit( history, '/sessions/first?settings=general' );
		const settings = await screen.findByRole( 'dialog', { name: 'Settings' } );
		fireEvent.click( within( settings ).getByRole( 'button', { name: 'Close settings' } ) );
		await waitFor( () => expect( screen.queryByRole( 'dialog' ) ).not.toBeInTheDocument() );
		fireEvent.click( screen.getByRole( 'button', { name: 'Add site' } ) );
		const addSite = await screen.findByRole( 'dialog', { name: 'Add site' } );
		fireEvent.click( within( addSite ).getByRole( 'button', { name: 'Close Add site' } ) );
		await waitFor( () => expect( screen.queryByRole( 'dialog' ) ).not.toBeInTheDocument() );
		await visit( history, '/sites/two' );
		fireEvent.click( back() );
		await waitFor( () => expect( history.location.pathname ).toBe( '/sessions/first' ) );
		expect( history.location.search ).toBe( '' );
		fireEvent.click( back() );
		await waitFor( () => expect( history.location.pathname ).toBe( '/sites/one' ) );
		fireEvent.click( forward() );
		await waitFor( () => expect( history.location.pathname ).toBe( '/sessions/first' ) );
		fireEvent.click( forward() );
		await waitFor( () => expect( history.location.pathname ).toBe( '/sites/two' ) );
		expect( screen.queryByRole( 'dialog' ) ).not.toBeInTheDocument();
	} );

	it( 'discards the forward branch when a different workspace is opened', async () => {
		const { history } = await setup();
		await visit( history, '/sessions/first' );
		await visit( history, '/sites/two' );
		fireEvent.click( back() );
		await waitFor( () => expect( history.location.pathname ).toBe( '/sessions/first' ) );
		await visit( history, '/sites/one/new' );
		expect( forward() ).toHaveAttribute( 'aria-disabled', 'true' );
		fireEvent.click( back() );
		await waitFor( () => expect( history.location.pathname ).toBe( '/sessions/first' ) );
		fireEvent.click( forward() );
		await waitFor( () => expect( history.location.pathname ).toBe( '/sites/one/new' ) );
	} );

	it( 'follows native history traversal without recording extra visits', async () => {
		const { history } = await setup();
		await visit( history, '/sessions/first' );
		await visit( history, '/sites/two' );
		await act( () => history.back() );
		await waitFor( () => expect( history.location.pathname ).toBe( '/sessions/first' ) );
		fireEvent.click( back() );
		await waitFor( () => expect( history.location.pathname ).toBe( '/sites/one' ) );
		await act( () => history.forward() );
		fireEvent.click( forward() );
		await waitFor( () => expect( history.location.pathname ).toBe( '/sites/two' ) );
	} );

	it( 'hides navigation while collapsed and remembers visits made before reopening', async () => {
		const { history } = await setup();
		await visit( history, '/sites/two' );
		const sidebar = back().closest( 'aside' )!;
		fireEvent.click( within( sidebar ).getByRole( 'button', { name: 'Hide sidebar' } ) );
		expect(
			screen.queryByRole( 'group', { name: 'Workspace navigation' } )
		).not.toBeInTheDocument();
		await visit( history, '/sessions/first' );
		await visit( history, '/sites/one/new' );
		fireEvent.click(
			within( screen.getByRole( 'main' ) ).getByRole( 'button', { name: 'Show sidebar' } )
		);
		await waitFor( () => expect( sidebar ).toContainElement( back() ) );
		fireEvent.click( back() );
		await waitFor( () => expect( history.location.pathname ).toBe( '/sessions/first' ) );
		fireEvent.click( back() );
		await waitFor( () => expect( history.location.pathname ).toBe( '/sites/two' ) );
	} );

	it( 'skips deleted sites and archived chats', async () => {
		const { history, queryClient } = await setup();
		await visit( history, '/sites/two' );
		await visit( history, '/sessions/first' );
		await visit( history, '/sites/one/new' );
		act( () => {
			queryClient.setQueryData( SITES_QUERY_KEY, [ sites[ 0 ] ] );
			queryClient.setQueryData( SESSIONS_QUERY_KEY, [
				{ ...sessions[ 0 ].summary, archived: true },
			] );
		} );
		await waitFor( () =>
			expect( screen.queryByRole( 'button', { name: 'Second site' } ) ).not.toBeInTheDocument()
		);
		fireEvent.click( back() );
		await waitFor( () => expect( history.location.pathname ).toBe( '/sites/one' ) );
		expect( forward() ).not.toHaveAttribute( 'aria-disabled', 'true' );
	} );
} );
