import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { expect, it } from 'vitest';
import { createFakeConnector, makeSite } from '@/test/fake-connector';
import { renderApp } from '@/test/render';

it( 'opens and starts a stopped Spotlight site', async () => {
	const connector = createFakeConnector( {
		sites: [
			makeSite( { id: 'one', name: 'First site' } ),
			makeSite( { id: 'two', name: 'My Portfolio' } ),
		],
	} );
	const { history } = renderApp( { connector, path: '/sites/one/new' } );
	await screen.findByRole( 'button', { name: 'First site' } );
	act( () => connector.emit( 'onOpenSite', { siteId: 'two' } ) );
	await waitFor( () => expect( history.location.pathname ).toBe( '/sites/two/new' ) );
	await screen.findByRole( 'button', { name: 'Stop My Portfolio' } );
	await waitFor( () => expect( document.querySelector( 'iframe' ) ).toBeInTheDocument() );
	fireEvent.load( document.querySelector( 'iframe' )! );
	expect( await screen.findByRole( 'complementary', { name: 'Site preview' } ) ).toBeVisible();
	expect( connector.startSite ).toHaveBeenCalledExactlyOnceWith( 'two' );
	expect( connector.openSiteUrl ).not.toHaveBeenCalled();
} );

it( 'opens a running Spotlight site without starting it again', async () => {
	const connector = createFakeConnector( {
		sites: [
			makeSite( { id: 'one', name: 'First site' } ),
			makeSite( { id: 'two', name: 'My Portfolio', running: true } ),
		],
	} );
	const { history } = renderApp( { connector, path: '/sites/one/new' } );
	await screen.findByRole( 'button', { name: 'First site' } );
	act( () => connector.emit( 'onOpenSite', { siteId: 'two' } ) );
	await waitFor( () => expect( history.location.pathname ).toBe( '/sites/two/new' ) );
	expect( await screen.findByRole( 'complementary', { name: 'Site preview' } ) ).toBeVisible();
	expect( connector.startSite ).not.toHaveBeenCalled();
} );

it( 'reports a failed start and keeps the selected site open', async () => {
	const connector = createFakeConnector( {
		sites: [
			makeSite( { id: 'one', name: 'First site' } ),
			makeSite( { id: 'two', name: 'My Portfolio' } ),
		],
	} );
	connector.startSite.mockRejectedValueOnce( new Error( 'The server could not start.' ) );
	const { history } = renderApp( { connector, path: '/sites/one/new' } );
	await screen.findByRole( 'button', { name: 'First site' } );
	act( () => connector.emit( 'onOpenSite', { siteId: 'two' } ) );
	await screen.findByText( 'Failed to start site' );
	expect( history.location.pathname ).toBe( '/sites/two/new' );
} );

it( 'handles a stale Spotlight result without opening another site', async () => {
	const connector = createFakeConnector( {
		sites: [ makeSite( { id: 'one', name: 'First site' } ) ],
	} );
	const { history } = renderApp( { connector, path: '/sites/one/new' } );
	await screen.findByRole( 'button', { name: 'First site' } );
	act( () => connector.emit( 'onOpenSite', { siteId: 'deleted' } ) );
	await screen.findByText( 'This site is no longer available in WordPress Studio.' );
	expect( history.location.pathname ).toBe( '/sites/one/new' );
	expect( connector.startSite ).not.toHaveBeenCalled();
} );
