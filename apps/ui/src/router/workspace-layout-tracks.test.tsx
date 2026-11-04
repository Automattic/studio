import { TRACKS_EVENTS } from '@studio/common/lib/record-tracks-event';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { setCommandPaletteOpen } from '@/data/use-command-palette';
import { setAnnotating } from '@/features/annotations';
import { createFakeConnector, makeSite } from '@/test/fake-connector';
import { renderApp } from '@/test/render';
import type { FakeConnector } from '@/test/fake-connector';

const event = TRACKS_EVENTS.WORKSPACE_LAYOUT_CHANGED;
const layoutEvents = ( connector: FakeConnector ) =>
	connector.trackEvent.mock.calls.filter( ( [ name ] ) => name === event );
const toggle = () => screen.getByRole( 'button', { name: /^(Show|Hide) panel$/ } );

beforeEach( () => localStorage.clear() );
afterEach( () => {
	act( () => {
		setAnnotating( 'one', false );
		setCommandPaletteOpen( false );
	} );
	vi.restoreAllMocks();
} );

async function setup( running = true, path = '/sites/one/new' ) {
	const connector = createFakeConnector( { sites: [ makeSite( { id: 'one', running } ) ] } );
	const view = renderApp( { connector, path } );
	await screen.findByRole( 'button', { name: /^(Show|Hide) panel$/ } );
	return { ...view, connector };
}

it( 'records each header transition once, with only layout and lookup context', async () => {
	const { connector } = await setup();
	expect( layoutEvents( connector ) ).toEqual( [] );
	for ( const [ name, layout ] of [
		[ 'Expand panel', 'panel' ],
		[ 'Restore split view', 'split' ],
		[ 'Hide panel', 'chat' ],
		[ 'Show panel', 'split' ],
	] ) {
		fireEvent.click( screen.getByRole( 'button', { name } ) );
		expect( toggle() ).toHaveAttribute( 'data-workspace-layout', layout );
	}
	expect( layoutEvents( connector ) ).toEqual(
		[ 'panel', 'split', 'chat', 'split' ].map( ( layout ) => [ event, { layout }, 'one' ] )
	);
} );

it( 'records menu/shortcut transitions, including the Chat tab, and suppresses no-ops', async () => {
	const { connector } = await setup();
	for ( const layout of [ 'split', 'panel', 'panel', 'chat', 'chat', 'split' ] as const ) {
		act( () => connector.emit( 'onSetWorkspaceLayout', layout ) );
		expect( toggle() ).toHaveAttribute( 'data-workspace-layout', layout );
	}
	act( () => connector.emit( 'onTogglePanel' ) );
	expect( toggle() ).toHaveAttribute( 'data-workspace-layout', 'chat' );
	expect( layoutEvents( connector ) ).toEqual(
		[ 'panel', 'chat', 'split', 'chat' ].map( ( layout ) => [ event, { layout }, 'one' ] )
	);
} );

it( 'records command palette selections through the same setters', async () => {
	const { connector } = await setup();
	for ( const layout of [ 'Panel', 'Chat', 'Split view' ] ) {
		act( () => setCommandPaletteOpen( true ) );
		const input = await screen.findByRole( 'combobox', { name: 'Search commands' } );
		fireEvent.change( input, { target: { value: `Switch to ${ layout }` } } );
		fireEvent.click(
			await screen.findByRole( 'option', { name: `Switch to ${ layout } My site` } )
		);
		await waitFor( () =>
			expect( screen.queryByRole( 'dialog', { name: 'Command palette' } ) ).not.toBeInTheDocument()
		);
	}
	expect( layoutEvents( connector ) ).toEqual(
		[ 'panel', 'chat', 'split' ].map( ( layout ) => [ event, { layout }, 'one' ] )
	);
} );

it.each( [ true, false ] )(
	'keeps site-start/stop auto-layout quiet (split on start: %s)',
	async ( split ) => {
		const connector = createFakeConnector( {
			sites: [ makeSite( { id: 'one', running: false } ) ],
			preferences: { openChatOnSiteStart: split },
		} );
		renderApp( { connector, path: '/sites/one/new' } );
		fireEvent.click( await screen.findByRole( 'button', { name: 'Start My site' } ) );
		await waitFor( () => expect( document.querySelector( 'iframe' ) ).toBeInTheDocument() );
		fireEvent.load( document.querySelector( 'iframe' )! );
		await waitFor( () =>
			expect( toggle() ).toHaveAttribute( 'data-workspace-layout', split ? 'split' : 'panel' )
		);
		fireEvent.click( await screen.findByRole( 'button', { name: 'Stop My site' } ) );
		await screen.findByRole( 'button', { name: 'Start My site' } );
		expect( layoutEvents( connector ) ).toEqual( [] );
	}
);

it( 'keeps annotation-forced split view quiet', async () => {
	const { connector } = await setup();
	fireEvent.click( screen.getByRole( 'button', { name: 'Expand panel' } ) );
	connector.trackEvent.mockClear();
	act( () => setAnnotating( 'one', true ) );
	await waitFor( () => expect( toggle() ).toHaveAttribute( 'data-workspace-layout', 'split' ) );
	act( () => setAnnotating( 'one', false ) );
	expect( layoutEvents( connector ) ).toEqual( [] );
} );

it( 'reports the effective narrow layout without recording the forced mode itself', async () => {
	const matchMedia = window.matchMedia.bind( window );
	const media = Object.assign( new EventTarget(), {
		matches: false,
		media: '(max-width: 540px)',
		onchange: null,
		addListener: () => {},
		removeListener: () => {},
	} );
	vi.spyOn( window, 'matchMedia' ).mockImplementation( ( query ) =>
		query === media.media ? ( media as MediaQueryList ) : matchMedia( query )
	);
	const { connector } = await setup();
	act( () => {
		media.matches = true;
		media.dispatchEvent( new Event( 'change' ) );
	} );
	expect( toggle() ).toHaveAttribute( 'data-workspace-layout', 'panel' );
	act( () => connector.emit( 'onSetWorkspaceLayout', 'split' ) );
	expect( layoutEvents( connector ) ).toEqual( [] );
	act( () => connector.emit( 'onSetWorkspaceLayout', 'chat' ) );
	act( () => connector.emit( 'onSetWorkspaceLayout', 'split' ) );
	act( () => {
		media.matches = false;
		media.dispatchEvent( new Event( 'change' ) );
	} );
	expect( toggle() ).toHaveAttribute( 'data-workspace-layout', 'split' );
	expect( layoutEvents( connector ) ).toEqual(
		[ 'chat', 'panel' ].map( ( layout ) => [ event, { layout }, 'one' ] )
	);
} );

it.each( [ 'Chat', 'Split view', 'Panel' ] )(
	'records a layout selected from the site home (%s)',
	async ( name ) => {
		const { connector, history } = await setup( true, '/sites/one' );
		const layout = name === 'Chat' ? 'chat' : name === 'Panel' ? 'panel' : 'split';
		act( () => connector.emit( 'onSetWorkspaceLayout', layout ) );
		await waitFor( () => expect( history.location.pathname ).toBe( '/sites/one/new' ) );
		expect( toggle() ).toHaveAttribute( 'data-workspace-layout', layout );
		expect( layoutEvents( connector ) ).toEqual(
			layout === 'panel' ? [] : [ [ event, { layout }, 'one' ] ]
		);
	}
);
