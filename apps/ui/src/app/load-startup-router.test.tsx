import { createMemoryHistory } from '@tanstack/react-router';
import { act, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SESSIONS_QUERY_KEY } from '@/data/queries/use-sessions';
import { SITES_QUERY_KEY } from '@/data/queries/use-sites';
import { createFakeConnector, makeSite } from '@/test/fake-connector';
import { createTestQueryClient, renderApp } from '@/test/render';
import { loadStartupRouter } from './load-startup-router';
import { App } from './index';

function deferred< T >() {
	let resolve!: ( value: T ) => void;
	const promise = new Promise< T >( ( done ) => {
		resolve = done;
	} );
	return { promise, resolve };
}

describe( 'native workspace startup', () => {
	it( 'waits for both lists and the initial redirect before revealing the workspace', async () => {
		const site = makeSite();
		const sites = deferred< ( typeof site )[] >();
		const sessions = deferred< [] >();
		const connector = createFakeConnector( { sites: [ site ] } );
		connector.getSites.mockImplementation( () => sites.promise );
		connector.getSessions.mockImplementation( () => sessions.promise );
		const queryClient = createTestQueryClient();
		const history = createMemoryHistory( { initialEntries: [ '/' ] } );
		const ready = vi.fn();
		const startup = loadStartupRouter( connector, queryClient, history ).then( ( router ) => {
			ready();
			return router;
		} );

		await waitFor( () => expect( connector.getSites ).toHaveBeenCalled() );
		expect( connector.getSessions ).toHaveBeenCalled();
		expect( ready ).not.toHaveBeenCalled();
		sites.resolve( [ site ] );
		await waitFor( () =>
			expect( queryClient.getQueryData( SITES_QUERY_KEY ) ).toEqual( [ site ] )
		);
		expect( ready ).not.toHaveBeenCalled();
		sessions.resolve( [] );
		const router = await startup;
		expect( history.location.pathname ).toBe( `/sites/${ site.id }/new` );
		expect( queryClient.getQueryData( SESSIONS_QUERY_KEY ) ).toEqual( [] );

		await act( async () => {
			render( <App connector={ connector } queryClient={ queryClient } router={ router } /> );
		} );
		await waitFor( () =>
			expect( screen.getByRole( 'combobox', { name: 'Message WordPress Studio' } ) ).toBeVisible()
		);
		expect( document.querySelector( 'aside [data-slot="skeleton"]' ) ).toBeNull();
	} );

	it( 'keeps the logo visible in the root fallback until both lists resolve', async () => {
		const site = makeSite();
		const sites = deferred< ( typeof site )[] >();
		const sessions = deferred< [] >();
		const connector = createFakeConnector( { sites: [ site ] } );
		connector.getSites.mockImplementation( () => sites.promise );
		connector.getSessions.mockImplementation( () => sessions.promise );
		renderApp( { connector } );
		expect( await screen.findByRole( 'status', { name: 'Loading Studio…' } ) ).toBeVisible();
		expect( screen.queryByRole( 'complementary' ) ).not.toBeInTheDocument();
		await act( async () => sites.resolve( [ site ] ) );
		expect( screen.getByRole( 'status', { name: 'Loading Studio…' } ) ).toBeVisible();
		expect( screen.queryByRole( 'complementary' ) ).not.toBeInTheDocument();
		await act( async () => sessions.resolve( [] ) );
		await waitFor( () =>
			expect( screen.getByRole( 'combobox', { name: 'Message WordPress Studio' } ) ).toBeVisible()
		);
		expect( screen.queryByRole( 'status', { name: 'Loading Studio…' } ) ).not.toBeInTheDocument();
	} );

	it( 'also waits for chats when opening a saved site URL directly', async () => {
		const site = makeSite();
		const sessions = deferred< [] >();
		const connector = createFakeConnector( { sites: [ site ] } );
		connector.getSessions.mockImplementation( () => sessions.promise );
		const ready = vi.fn();
		const startup = loadStartupRouter(
			connector,
			createTestQueryClient(),
			createMemoryHistory( {
				initialEntries: [ `/sites/${ site.id }/new` ],
			} )
		).then( ready );
		await waitFor( () => expect( connector.getSessions ).toHaveBeenCalled() );
		expect( ready ).not.toHaveBeenCalled();
		sessions.resolve( [] );
		await startup;
		expect( ready ).toHaveBeenCalled();
	} );

	it( 'reaches the empty workspace when there are no sites', async () => {
		const connector = createFakeConnector();
		const history = createMemoryHistory( { initialEntries: [ '/' ] } );
		await loadStartupRouter( connector, createTestQueryClient(), history );
		expect( history.location.pathname ).toBe( '/sites' );
	} );

	it( 'hands a failed site load to the existing retry screen', async () => {
		const connector = createFakeConnector();
		connector.getSites.mockRejectedValue( new Error( 'Sites unavailable' ) );
		const queryClient = createTestQueryClient();
		const history = createMemoryHistory( { initialEntries: [ '/' ] } );
		const router = await loadStartupRouter( connector, queryClient, history );
		await act( async () => {
			render( <App connector={ connector } queryClient={ queryClient } router={ router } /> );
		} );
		expect( await screen.findByRole( 'button', { name: 'Try again' } ) ).toBeVisible();
	} );
} );
