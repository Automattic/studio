import { TRACKS_EVENTS, type TracksEventName } from '@studio/common/lib/record-tracks-event';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it } from 'vitest';
import { createFakeConnector, makeSite } from '@/test/fake-connector';
import { renderApp } from '@/test/render';

beforeEach( () => localStorage.clear() );

const openEvents: TracksEventName[] = [
	TRACKS_EVENTS.SITE_OPEN_IN_BROWSER,
	TRACKS_EVENTS.SITE_OPEN_WP_ADMIN,
	TRACKS_EVENTS.SITE_OPEN_PHPMYADMIN,
	TRACKS_EVENTS.SITE_OPEN_DESIGN_SYSTEM,
	TRACKS_EVENTS.SITE_OPEN_EMAIL,
];
const contentEvents = ( connector: ReturnType< typeof createFakeConnector > ) =>
	connector.trackEvent.mock.calls.filter( ( [ name ] ) => openEvents.includes( name ) );

async function setup() {
	const connector = createFakeConnector( {
		sites: [ makeSite( { id: 'one', name: 'First', running: true } ) ],
	} );
	connector.getSiteDesign.mockResolvedValue( {
		design:
			'---\ncolors:\n  primary: "#c2552b"\n  background: "#ffffff"\ntypography:\n  body:\n    fontFamily: "Inter"\n---\n# Design system',
		themeJson: {},
	} );
	const view = renderApp( { connector, path: '/sites/one/new' } );
	await screen.findByRole( 'button', { name: 'Hide panel' } );
	expect( contentEvents( connector ) ).toEqual( [] );
	return { ...view, connector };
}

it.each( [
	[ 'Browser', 'First', TRACKS_EVENTS.SITE_OPEN_IN_BROWSER ],
	[ 'Admin', 'Admin', TRACKS_EVENTS.SITE_OPEN_WP_ADMIN ],
	[ 'Database', 'Database', TRACKS_EVENTS.SITE_OPEN_PHPMYADMIN ],
	[ 'Design system', 'Design system', TRACKS_EVENTS.SITE_OPEN_DESIGN_SYSTEM ],
	[ 'Email log', 'Email log', TRACKS_EVENTS.SITE_OPEN_EMAIL ],
] as const )(
	'records %s opens and tab switches once, with only the internal browser prop',
	async ( tool, tabName, event ) => {
		const { connector, user } = await setup();
		await user.click( screen.getByRole( 'button', { name: 'New tab' } ) );
		await user.click( await screen.findByRole( 'menuitem', { name: tool } ) );
		const tabs = screen.getAllByRole( 'tab', { name: tabName } );
		const target = tabs[ tabs.length - 1 ];
		expect( target ).toHaveAttribute( 'aria-selected', 'true' );
		expect( contentEvents( connector ) ).toEqual( [ [ event, { browser: 'internal' } ] ] );
		await user.click( target );
		expect( contentEvents( connector ) ).toHaveLength( 1 );
		await user.click( screen.getAllByRole( 'tab' )[ 0 ] );
		await user.click( target );
		expect( contentEvents( connector ) ).toEqual( [
			[ event, { browser: 'internal' } ],
			[ TRACKS_EVENTS.SITE_OPEN_IN_BROWSER, { browser: 'internal' } ],
			[ event, { browser: 'internal' } ],
		] );
	}
);

it( 'records tool shortcuts without a duplicate from the selected tab mounting', async () => {
	const { connector, user } = await setup();
	await user.click( screen.getByRole( 'button', { name: 'New tab' } ) );
	await screen.findByRole( 'menuitem', { name: 'Admin' } );
	await user.keyboard( 'a' );
	expect( screen.getByRole( 'tab', { name: 'Admin' } ) ).toHaveAttribute( 'aria-selected', 'true' );
	expect( contentEvents( connector ) ).toEqual( [
		[ TRACKS_EVENTS.SITE_OPEN_WP_ADMIN, { browser: 'internal' } ],
	] );
} );

it.each( [ 'rejected', 'throwing' ] )( 'opens content when telemetry is %s', async ( failure ) => {
	const { connector, user } = await setup();
	if ( failure === 'rejected' ) connector.trackEvent.mockRejectedValue( new Error( 'Offline' ) );
	else
		connector.trackEvent.mockImplementation( () => {
			throw new Error( 'Unavailable' );
		} );
	await user.click( screen.getByRole( 'button', { name: 'New tab' } ) );
	await user.click( await screen.findByRole( 'menuitem', { name: 'Admin' } ) );
	expect( screen.getByRole( 'tab', { name: 'Admin' } ) ).toHaveAttribute( 'aria-selected', 'true' );
} );

it( 'keeps free-form address navigation and frame loads quiet', async () => {
	const { connector, user } = await setup();
	const address = screen.getByRole( 'textbox', { name: 'Address' } );
	await user.clear( address );
	await user.type( address, '/wp-admin/{Enter}' );
	await waitFor( () =>
		expect( screen.getByRole( 'tab', { name: 'Admin' } ) ).toHaveAttribute(
			'aria-selected',
			'true'
		)
	);
	for ( const frame of document.querySelectorAll( 'iframe' ) ) fireEvent.load( frame );
	await act( async () => {} );
	expect( contentEvents( connector ) ).toEqual( [] );
} );

it( 'opens a project tool from the site menu and records panel reveal separately', async () => {
	const { connector, user } = await setup();
	await user.click( screen.getByRole( 'button', { name: 'Hide panel' } ) );
	connector.trackEvent.mockClear();
	await user.click( screen.getByRole( 'button', { name: 'Site menu' } ) );
	await user.click( await screen.findByRole( 'menuitem', { name: 'Tools' } ) );
	await screen.findByRole( 'menuitem', { name: 'Admin' } );
	await user.keyboard( 'a' );
	await waitFor( () =>
		expect( screen.getByRole( 'button', { name: 'Hide panel' } ) ).toHaveAttribute(
			'data-workspace-layout',
			'split'
		)
	);
	expect( connector.trackEvent.mock.calls ).toEqual( [
		[ TRACKS_EVENTS.SITE_OPEN_WP_ADMIN, { browser: 'internal' } ],
		[ TRACKS_EVENTS.WORKSPACE_LAYOUT_CHANGED, { layout: 'split' }, 'one' ],
	] );
} );

it( 'records a tool open after starting its site without attributing the lifecycle layout to the user', async () => {
	const connector = createFakeConnector( { sites: [ makeSite( { id: 'one', running: false } ) ] } );
	const { user } = renderApp( { connector, path: '/sites/one/new' } );
	await user.click( await screen.findByRole( 'button', { name: 'Site menu' } ) );
	await user.click( await screen.findByRole( 'menuitem', { name: 'Tools' } ) );
	await screen.findByRole( 'menuitem', { name: 'Admin' } );
	await user.keyboard( 'a' );
	await waitFor( () => expect( document.querySelector( 'iframe' ) ).toBeInTheDocument() );
	fireEvent.load( document.querySelector( 'iframe' )! );
	await waitFor( () =>
		expect( contentEvents( connector ) ).toEqual( [
			[ TRACKS_EVENTS.SITE_OPEN_WP_ADMIN, { browser: 'internal' } ],
		] )
	);
	expect(
		connector.trackEvent.mock.calls.filter(
			( [ name ] ) => name === TRACKS_EVENTS.WORKSPACE_LAYOUT_CHANGED
		)
	).toEqual( [] );
} );
