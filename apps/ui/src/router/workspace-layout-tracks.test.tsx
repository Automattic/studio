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
		if ( name === 'Hide panel' || name === 'Show panel' ) {
			expect( document.querySelector( '[data-layout-moving]' ) ).toBeInTheDocument();
		}
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

it( 'offers one panel toggle without separate layout commands in the palette', async () => {
	await setup();
	act( () => setCommandPaletteOpen( true ) );
	const input = await screen.findByRole( 'combobox', { name: 'Search commands' } );
	fireEvent.change( input, { target: { value: 'panel' } } );
	expect( await screen.findByRole( 'option', { name: 'Toggle panel' } ) ).toBeVisible();
	fireEvent.change( input, { target: { value: 'Switch to' } } );
	expect(
		screen.queryByRole( 'option', { name: /^Switch to (Panel|Chat|Split view)/ } )
	).not.toBeInTheDocument();
} );

it.each( [ 'menu', 'slash', 'palette' ] )(
	'shows and hides the panel instantly through %s without changing preferences',
	async ( source ) => {
		const { connector } = await setup();
		for ( const layout of [ 'chat', 'split' ] ) {
			if ( source === 'palette' ) {
				act( () => setCommandPaletteOpen( true ) );
				const input = await screen.findByRole( 'combobox', { name: 'Search commands' } );
				fireEvent.change( input, { target: { value: 'panel' } } );
			} else if ( source === 'slash' ) {
				const input = await screen.findByRole( 'combobox' );
				fireEvent.change( input, { target: { value: 'Keep this draft /panel' } } );
			} else {
				fireEvent.click( await screen.findByRole( 'button', { name: 'Add' } ) );
			}
			fireEvent.click(
				await screen.findByRole( 'option', {
					name:
						source === 'palette'
							? 'Toggle panel'
							: 'Toggle panel Show or hide the panel beside your chat.',
				} )
			);
			expect( document.querySelector( '[data-layout-moving]' ) ).not.toBeInTheDocument();
			await waitFor( () => expect( toggle() ).toHaveAttribute( 'data-workspace-layout', layout ) );
			if ( source === 'slash' ) {
				expect( screen.getByRole( 'combobox' ) ).toHaveValue( 'Keep this draft ' );
			}
		}
		expect( layoutEvents( connector ) ).toEqual(
			[ 'chat', 'split' ].map( ( layout ) => [ event, { layout }, 'one' ] )
		);
		expect( connector.continueSession ).not.toHaveBeenCalled();
		expect( connector.setUserPreferences ).not.toHaveBeenCalled();
	}
);

it( 'uses the panel visibility on site home and restores it from the Chat tab', async () => {
	const { connector, history } = await setup( true, '/sites/one' );
	act( () => setCommandPaletteOpen( true ) );
	fireEvent.change( await screen.findByRole( 'combobox', { name: 'Search commands' } ), {
		target: { value: 'panel' },
	} );
	fireEvent.click( await screen.findByRole( 'option', { name: 'Toggle panel' } ) );
	await waitFor( () => expect( history.location.pathname ).toBe( '/sites/one/new' ) );
	await waitFor( () => expect( toggle() ).toHaveAttribute( 'data-workspace-layout', 'chat' ) );
	connector.trackEvent.mockClear();
	for ( let attempt = 0; attempt < 2; attempt++ ) {
		act( () => setCommandPaletteOpen( true ) );
		const input = await screen.findByRole( 'combobox', { name: 'Search commands' } );
		fireEvent.change( input, { target: { value: 'panel' } } );
		fireEvent.click( await screen.findByRole( 'option', { name: 'Toggle panel' } ) );
		await waitFor( () => expect( history.location.pathname ).toBe( '/sites/one/new' ) );
		await waitFor( () => expect( toggle() ).toHaveAttribute( 'data-workspace-layout', 'split' ) );
		if ( attempt === 0 ) {
			fireEvent.click( screen.getByRole( 'button', { name: 'Expand panel' } ) );
			act( () => connector.emit( 'onSetWorkspaceLayout', 'chat' ) );
			expect( toggle() ).toHaveAttribute( 'data-workspace-layout', 'chat' );
			connector.trackEvent.mockClear();
		}
	}
	expect( layoutEvents( connector ) ).toEqual( [ [ event, { layout: 'split' }, 'one' ] ] );
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
		await waitFor( () =>
			expect( layoutEvents( connector ) ).toEqual(
				layout === 'panel' ? [] : [ [ event, { layout }, 'one' ] ]
			)
		);
	}
);

it( 'does not attribute a site-start layout change during pending layout navigation to the user', async () => {
	const { connector, history } = await setup( false, '/sites/one' );
	let finish!: () => void;
	const navigation = new Promise< void >( ( resolve ) => {
		finish = resolve;
	} );
	const unblock = history.block( {
		blockerFn: async () => {
			await navigation;
			return false;
		},
	} );
	try {
		act( () => connector.emit( 'onSetWorkspaceLayout', 'panel' ) );
		await act( async () => {
			await connector.startSite( 'one' );
		} );
		await waitFor( () => expect( document.querySelector( 'iframe' ) ).toBeInTheDocument() );
		fireEvent.load( document.querySelector( 'iframe' )! );
		await screen.findByRole( 'button', { name: 'Stop My site' } );
		await act( async () => {
			finish();
			await navigation;
		} );
		await waitFor( () => expect( history.location.pathname ).toBe( '/sites/one/new' ) );
		await waitFor( () => expect( toggle() ).toHaveAttribute( 'data-workspace-layout', 'split' ) );
		expect( layoutEvents( connector ) ).toEqual( [] );
	} finally {
		unblock();
		finish();
	}
} );
