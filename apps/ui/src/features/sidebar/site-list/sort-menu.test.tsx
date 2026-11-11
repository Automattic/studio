import { fireEvent, screen, waitFor, within, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { resetLocaleData, setLocaleData } from '@wordpress/i18n';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { createFakeConnector, makeSite, makeSession } from '@/test/fake-connector';
import { renderApp } from '@/test/render';

beforeEach( () => localStorage.clear() );
afterEach( () => resetLocaleData() );

const sites = [
	makeSite( { id: 'a', name: 'Alpha', running: false } ),
	makeSite( { id: 'b', name: 'Beta', running: true } ),
];
const sessions = [ 'old', 'new' ].map( ( id, index ) => ( {
	summary: makeSession( {
		id,
		title: id === 'old' ? 'Older chat' : 'Newer chat',
		ownerSiteId: 'a',
		updatedAt: `2026-01-0${ index + 1 }T00:00:00Z`,
	} ),
	entries: [],
} ) );

it( 'defaults Pinned to Type, restores manual order, and keeps the menu choices ordered', async () => {
	const connector = createFakeConnector( {
		sites,
		sessions,
		preferences: { sidebarPins: [ 'chat:old', 'site:b' ] },
	} );
	renderApp( { connector, path: '/sites/a' } );
	const group = within( await screen.findByRole( 'group', { name: 'Pinned' } ) );
	const labels = () =>
		group
			.getAllByRole( 'button' )
			.filter( ( button ) => [ 'Beta', 'Older chat' ].includes( button.textContent ?? '' ) )
			.map( ( button ) => button.textContent );
	await waitFor( () => expect( labels() ).toEqual( [ 'Beta', 'Older chat' ] ) );
	fireEvent.click( group.getByRole( 'button', { name: 'Sort by' } ) );
	expect( await screen.findByRole( 'menuitemradio', { name: 'Type' } ) ).toBeChecked();
	expect( screen.getAllByRole( 'menuitemradio' ).map( ( item ) => item.textContent ) ).toEqual( [
		'Type',
		'Manual order',
	] );
	fireEvent.click( screen.getByRole( 'menuitemradio', { name: 'Manual order' } ) );
	await waitFor( () => expect( labels() ).toEqual( [ 'Older chat', 'Beta' ] ) );
	expect( connector.state.preferences.sidebarPinnedSort ).toBe( 'manual' );
	expect( connector.state.preferences.sidebarPins ).toEqual( [ 'chat:old', 'site:b' ] );
} );

it( 'sorts sites by confirmed running status and restores manual order through the submenu', async () => {
	const connector = createFakeConnector( { sites } );
	const { queryClient } = renderApp( { connector, path: '/sites/a' } );
	const group = within( await screen.findByRole( 'group', { name: 'Sites' } ) );
	const labels = () =>
		group
			.getAllByRole( 'button' )
			.filter( ( button ) => [ 'Alpha', 'Beta' ].includes( button.textContent ?? '' ) )
			.map( ( button ) => button.textContent );
	fireEvent.click( group.getByRole( 'button', { name: 'Sort by' } ) );
	expect( screen.getAllByRole( 'menuitem' ).map( ( item ) => item.textContent ) ).toEqual( [
		'Sort sites by',
		'Sort chats by',
	] );
	fireEvent.click( screen.getByRole( 'menuitem', { name: 'Sort sites by' } ) );
	fireEvent.click( await screen.findByRole( 'menuitemradio', { name: 'Status' } ) );
	await waitFor( () => expect( labels() ).toEqual( [ 'Beta', 'Alpha' ] ) );
	await act( async () => {
		queryClient.setQueryData(
			[ 'sites' ],
			sites.map( ( site ) => ( { ...site, running: ! site.running } ) )
		);
	} );
	await waitFor( () => expect( labels() ).toEqual( [ 'Alpha', 'Beta' ] ) );
	fireEvent.click( group.getByRole( 'button', { name: 'Sort by' } ) );
	fireEvent.click( await screen.findByRole( 'menuitem', { name: 'Sort sites by' } ) );
	fireEvent.click( await screen.findByRole( 'menuitemradio', { name: 'Manual order' } ) );
	await waitFor( () => expect( connector.state.preferences.sidebarSiteSort ).toBe( 'manual' ) );
} );

it( 'changes nested chat sorting while preserving saved chat order and Recent', async () => {
	const connector = createFakeConnector( {
		sites,
		sessions,
		preferences: { sidebarChatOrder: { a: [ 'old', 'new' ] } },
	} );
	renderApp( { connector, path: '/sites/a' } );
	const chats = within( await screen.findByRole( 'group', { name: 'Alpha chats' } ) );
	const labels = () =>
		chats
			.getAllByRole( 'button', { name: /^(Older|Newer) chat$/ } )
			.map( ( button ) => button.textContent );
	await waitFor( () => expect( labels() ).toEqual( [ 'Older chat', 'Newer chat' ] ) );
	fireEvent.click( screen.getByRole( 'button', { name: 'Sort by' } ) );
	fireEvent.click( await screen.findByRole( 'menuitem', { name: 'Sort chats by' } ) );
	expect( await screen.findByRole( 'menuitemradio', { name: 'Manual order' } ) ).toBeChecked();
	fireEvent.click( screen.getByRole( 'menuitemradio', { name: 'Last updated' } ) );
	await waitFor( () => expect( labels() ).toEqual( [ 'Newer chat', 'Older chat' ] ) );
	expect( connector.state.preferences.sidebarChatOrder ).toEqual( { a: [ 'old', 'new' ] } );
	expect(
		within( screen.getByRole( 'group', { name: 'Recent' } ) )
			.getAllByRole( 'button', { name: /^(Older|Newer) chat$/ } )
			.map( ( button ) => button.textContent )
	).toEqual( [ 'Newer chat', 'Older chat' ] );
} );

it.each( [
	[ 'ltr', 'ArrowRight' ],
	[ 'rtl', 'ArrowLeft' ],
] )(
	'opens submenus outward in %s and restores trigger focus after Escape',
	async ( direction, key ) => {
		setLocaleData( { 'text direction\u0004ltr': [ direction ] } );
		const user = userEvent.setup();
		renderApp( { connector: createFakeConnector( { sites } ), path: '/sites/a' } );
		const trigger = await screen.findByRole( 'button', { name: 'Sort by' } );
		act( () => trigger.focus() );
		await user.keyboard( '{Enter}' );
		await waitFor( () =>
			expect( screen.getByRole( 'menuitem', { name: 'Sort sites by' } ) ).toHaveFocus()
		);
		await user.keyboard( `{${ key }}` );
		expect( await screen.findByRole( 'menuitemradio', { name: 'Status' } ) ).toBeVisible();
		await user.keyboard( '{Escape}{Escape}' );
		await waitFor( () => expect( trigger ).toHaveFocus() );
	}
);
