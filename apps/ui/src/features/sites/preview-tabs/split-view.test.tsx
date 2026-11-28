import {
	INSPECTOR_BRIDGE_PREFIX,
	INSPECTOR_PAGE_SCRIPT,
} from '@studio/agent/protocol/inspector/page-script';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { isAppleOS } from '@wordpress/keycodes';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
	changeAnnotation,
	getSiteAnnotations,
	requestAnnotationReview,
	setAnnotating,
	stageAnnotations,
} from '@/features/annotations';
import { createFakeConnector, makeSite } from '@/test/fake-connector';
import { renderApp } from '@/test/render';

const REAL_USER_AGENT = window.navigator.userAgent;
let availableWidth = 1100;
let measure = () => {};
let sequence = 0;
let user: ReturnType< typeof renderApp >[ 'user' ];

beforeEach( () => {
	localStorage.clear();
	availableWidth = 1100;
	const original = HTMLElement.prototype.getBoundingClientRect;
	vi.spyOn( HTMLElement.prototype, 'getBoundingClientRect' ).mockImplementation( function (
		this: HTMLElement
	) {
		return this.hasAttribute( 'data-preview-workspace' )
			? new DOMRect( 300, 0, availableWidth, 800 )
			: original.call( this );
	} );
	vi.stubGlobal(
		'ResizeObserver',
		class {
			constructor( private callback: () => void ) {}
			observe( element: Element ) {
				if ( element.hasAttribute( 'data-preview-workspace' ) ) measure = this.callback;
			}
			unobserve() {}
			disconnect() {}
		}
	);
} );

afterEach( () => {
	Object.defineProperty( window.navigator, 'userAgent', {
		value: REAL_USER_AGENT,
		configurable: true,
	} );
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
} );

async function setup(
	configure?: ( connector: ReturnType< typeof createFakeConnector >, siteId: string ) => void
) {
	const siteId = `split-${ ++sequence }`;
	const connector = createFakeConnector( {
		sites: [ makeSite( { id: siteId, name: 'First', running: true } ) ],
	} );
	configure?.( connector, siteId );
	const view = renderApp( { connector, path: `/sites/${ siteId }/new` } );
	user = view.user;
	await screen.findByRole( 'button', { name: 'Site menu' } );
	if ( screen.queryByRole( 'button', { name: 'Show panel' } ) )
		fireEvent.click( screen.getByRole( 'button', { name: 'Show panel' } ) );
	return { ...view, siteId };
}

async function addTab( name = 'Browser' ) {
	await user.click( screen.getByRole( 'button', { name: 'New tab' } ) );
	await user.click( await screen.findByRole( 'menuitem', { name } ) );
	await waitFor( () =>
		expect(
			screen.getAllByRole( 'tab' )[ screen.getAllByRole( 'tab' ).length - 1 ]
		).toHaveAttribute( 'aria-selected', 'true' )
	);
}

async function split( tab: HTMLElement ) {
	fireEvent.contextMenu( tab );
	await user.click( await screen.findByRole( 'menuitem', { name: 'Open as split' } ) );
	await screen.findByRole( 'group', { name: 'Split view' } );
}

async function showDeviceToolbar() {
	await user.click( screen.getByRole( 'button', { name: 'Browser options' } ) );
	await user.click( await screen.findByRole( 'menuitem', { name: 'Show device toolbar' } ) );
}

function navigate( pane: HTMLElement, path: string ) {
	const address = within( pane ).getByRole( 'textbox', { name: 'Address' } );
	fireEvent.pointerDown( address );
	fireEvent.change( address, { target: { value: path } } );
	fireEvent.submit( address.closest( 'form' )! );
}

it( 'keeps each browser bar fitted to its own pane when switching focus', async () => {
	vi.spyOn( HTMLElement.prototype, 'clientWidth', 'get' ).mockImplementation( function (
		this: HTMLElement
	) {
		return this.closest( '[data-split-start]' ) ? 320 : 780;
	} );
	await setup();
	await addTab( 'Admin' );
	const tabs = screen.getAllByRole( 'tab' );
	await user.click( tabs[ 0 ] );
	await split( tabs[ 1 ] );
	const first = within( screen.getByRole( 'complementary', { name: 'First panel' } ) );
	const second = within( screen.getByRole( 'complementary', { name: 'Second panel' } ) );
	const firstBar = first.getByRole( 'toolbar', { name: 'Preview browser controls' } );
	const secondBar = second.getByRole( 'toolbar', { name: 'Preview browser controls' } );
	expect( firstBar ).toHaveAttribute( 'data-site-header-layout', 'mobile-overflow' );
	expect( secondBar ).toHaveAttribute( 'data-site-header-layout', 'inline' );
	for ( const pane of [ first, second ] ) {
		await user.click( pane.getByRole( 'button', { name: 'Browser options' } ) );
		expect( await screen.findByRole( 'menuitem', { name: 'Show device toolbar' } ) ).toBeVisible();
		await user.keyboard( '{Escape}' );
	}

	await user.click( first.getByRole( 'button', { name: 'Reload' } ) );
	expect( firstBar ).toHaveAttribute( 'data-site-header-layout', 'mobile-overflow' );
	expect( secondBar ).toHaveAttribute( 'data-site-header-layout', 'inline' );
} );

it.each( [ 0, 1 ] )(
	'keeps pages mounted and focuses the survivor when closing pane %i',
	async ( closing ) => {
		const { connector } = await setup();
		await addTab( 'Database' );
		const tabs = screen.getAllByRole( 'tab' );
		const pages = [
			document.querySelector( 'iframe[src="http://localhost:9010/"]' ),
			document.querySelector( 'iframe[src*="phpmyadmin"]' ),
		];
		fireEvent.click( tabs[ 0 ] );
		await split( tabs[ 1 ] );
		expect(
			screen.getByRole( 'complementary', { name: 'First panel' } ).querySelector( 'iframe' )
		).toBe( pages[ 0 ] );
		expect(
			screen.getByRole( 'complementary', { name: 'Second panel' } ).querySelector( 'iframe' )
		).toBe( pages[ 1 ] );
		await addTab( 'Email log' );

		expect( screen.queryByRole( 'group', { name: 'Split view' } ) ).not.toBeInTheDocument();
		await user.click( screen.getByRole( 'tab', { name: 'First · Database' } ) );
		expect( await screen.findByRole( 'group', { name: 'Split view' } ) ).toBeInTheDocument();
		const pair = screen.getByRole( 'tab', { name: 'First · Database', selected: true } );
		expect( screen.getAllByRole( 'tab' ) ).toHaveLength( 2 );
		expect( screen.getAllByRole( 'button', { name: 'Browser options' } ) ).toHaveLength( 2 );
		const tab = within( pair.closest< HTMLElement >( '[data-tab-reorder-id]' )! );
		expect( tab.getByRole( 'button', { name: 'Close First' } ) ).toBeInTheDocument();
		expect( tab.getByRole( 'button', { name: 'Close Database' } ) ).toBeInTheDocument();
		await user.click(
			within(
				screen.getByRole( 'complementary', {
					name: closing === 0 ? 'First panel' : 'Second panel',
				} )
			).getByRole( 'button', { name: 'Close tab' } )
		);
		expect( screen.queryByRole( 'group', { name: 'Split view' } ) ).not.toBeInTheDocument();
		const remaining = screen.getByRole( 'tab', { name: closing === 0 ? 'Database' : 'First' } );
		expect( remaining ).toHaveAttribute( 'aria-selected', 'true' );
		expect( remaining.closest( 'main' )?.querySelector( '[data-visible-tab] iframe' ) ).toBe(
			pages[ 1 - closing ]
		);
		expect( connector.stopSite ).not.toHaveBeenCalled();
		await waitFor( () => expect( remaining ).toHaveFocus() );
	}
);

it( 'keeps ordinary browser splits independent, including their responsive settings', async () => {
	await setup();
	await addTab();
	const tabs = screen.getAllByRole( 'tab' );
	await showDeviceToolbar();
	fireEvent.click( tabs[ 0 ] );
	await split( tabs[ 1 ] );
	const first = screen.getByRole( 'complementary', { name: 'First panel' } );
	const second = screen.getByRole( 'complementary', { name: 'Second panel' } );
	navigate( second, '/about/' );
	expect( within( first ).getByRole( 'textbox', { name: 'Address' } ) ).toHaveValue(
		'http://localhost:9010'
	);
	expect( within( second ).getByRole( 'textbox', { name: 'Address' } ) ).toHaveValue(
		'http://localhost:9010/about/'
	);
	expect(
		within( second ).getByRole( 'toolbar', { name: 'Responsive preview' } )
	).toBeInTheDocument();
	expect(
		within( first ).queryByRole( 'toolbar', { name: 'Responsive preview' } )
	).not.toBeInTheDocument();
	navigate( second, '/independent/' );
	expect( within( first ).getByRole( 'textbox', { name: 'Address' } ) ).toHaveValue(
		'http://localhost:9010'
	);
} );

it( 'resizes with the keyboard and restores the preferred proportion after a narrow window', async () => {
	await setup();
	await addTab();
	const tabs = screen.getAllByRole( 'tab' );
	fireEvent.click( tabs[ 0 ] );
	await split( tabs[ 1 ] );
	const handle = screen.getByRole( 'separator', { name: 'Resize split view' } );
	expect( handle ).toHaveAttribute( 'aria-valuenow', '550' );
	fireEvent.keyDown( handle, { key: 'ArrowRight' } );
	expect( handle ).toHaveAttribute( 'aria-valuenow', '566' );
	act( () => {
		availableWidth = 600;
		measure();
	} );
	expect( screen.getByRole( 'separator', { name: 'Resize split view' } ) ).toHaveAttribute(
		'aria-valuenow',
		'300'
	);
	expect( screen.getAllByRole( 'textbox', { name: 'Address' } ) ).toHaveLength( 2 );
	act( () => {
		availableWidth = 1100;
		measure();
	} );
	expect( screen.getByRole( 'separator', { name: 'Resize split view' } ) ).toHaveAttribute(
		'aria-valuenow',
		'566'
	);
	fireEvent.keyDown( handle, { key: 'Home' } );
	expect( handle ).toHaveAttribute( 'aria-valuemin', '320' );
	expect( handle ).toHaveAttribute( 'aria-valuemax', '780' );
	expect( handle ).toHaveAttribute( 'aria-valuenow', '320' );
	expect( screen.getByRole( 'tab', { name: / · / } ) ).toBeInTheDocument();
	fireEvent.keyDown( handle, { key: 'End' } );
	expect( handle ).toHaveAttribute( 'aria-valuenow', '780' );
	fireEvent.mouseDown( handle, { button: 0, detail: 2 } );
	expect( handle ).toHaveAttribute( 'aria-valuenow', '550' );
	expect( screen.getAllByRole( 'textbox', { name: 'Address' } ) ).toHaveLength( 2 );
} );

it( 'offers only new tabs and tools in the plus menu', async () => {
	await setup();
	await addTab( 'Email log' );

	await user.click( screen.getByRole( 'button', { name: 'New tab' } ) );
	await screen.findByRole( 'menuitem', { name: 'Browser' } );
	expect( screen.getAllByRole( 'menuitem' ).map( ( item ) => item.textContent?.trim() ) ).toEqual(
		expect.arrayContaining( [
			expect.stringMatching( /^Browser/ ),
			expect.stringMatching( /^Email log/ ),
		] )
	);
	expect(
		screen.queryByRole( 'menuitem', { name: /split|responsive preview/i } )
	).not.toBeInTheDocument();
	await user.keyboard( '{Escape}' );
	await split( screen.getByRole( 'tab', { name: 'Email log' } ) );
	fireEvent.contextMenu( screen.getByRole( 'tab', { name: / · / } ) );
	await user.click( await screen.findByRole( 'menuitem', { name: 'Separate tabs' } ) );
	expect( screen.queryByRole( 'group', { name: 'Split view' } ) ).not.toBeInTheDocument();
} );

it( 'combines a Shift-click range and merges an existing split into it', async () => {
	await setup();
	await addTab( 'Admin' );
	await addTab( 'Database' );
	await addTab( 'Email log' );
	const [ browser, admin, database, email ] = screen.getAllByRole( 'tab' );
	const frames = new Set( document.querySelectorAll( 'iframe' ) );
	await user.click( admin );
	fireEvent.click( email, { shiftKey: true } );
	expect( screen.getAllByRole( 'tab', { selected: true } ) ).toEqual( [ admin, database, email ] );
	expect( screen.queryByRole( 'group', { name: 'Split view' } ) ).not.toBeInTheDocument();

	fireEvent.contextMenu( database );
	await user.click( await screen.findByRole( 'menuitem', { name: 'Open as split' } ) );
	const split = screen.getByRole( 'tab', { name: 'Admin · Database · Email log', selected: true } );
	expect( screen.getAllByRole( 'tab' ) ).toEqual( [ browser, split ] );
	await waitFor( () => expect( split ).toHaveFocus() );

	await user.keyboard( '{Shift>}{ArrowLeft}{/Shift}' );
	expect( screen.getAllByRole( 'tab', { selected: true } ) ).toEqual( [ browser, split ] );
	await user.keyboard( '{Shift>}{F10}{/Shift}' );
	await user.click( await screen.findByRole( 'menuitem', { name: 'Open as split' } ) );
	expect( screen.getAllByRole( 'tab' ) ).toEqual( [
		screen.getByRole( 'tab', { name: 'First · Admin · Database · Email log', selected: true } ),
	] );
	expect( new Set( document.querySelectorAll( 'iframe' ) ) ).toEqual( frames );
} );

it( 'combines nonadjacent tabs in strip order and leaves the other tabs separate', async () => {
	await setup();
	await addTab( 'Admin' );
	await addTab( 'Database' );
	const [ browser, admin, database ] = screen.getAllByRole( 'tab' );
	const modifier = isAppleOS() ? { metaKey: true } : { ctrlKey: true };
	fireEvent.click( browser, modifier );
	expect( screen.getAllByRole( 'tab', { selected: true } ) ).toEqual( [ browser, database ] );
	fireEvent.contextMenu( admin );
	expect( screen.queryByRole( 'menuitem', { name: /^Close tabs$/ } ) ).not.toBeInTheDocument();
	await user.keyboard( '{Escape}' );

	fireEvent.click( browser, modifier );
	fireEvent.contextMenu( browser );
	await user.click( await screen.findByRole( 'menuitem', { name: 'Open as split' } ) );
	expect( screen.getAllByRole( 'tab' ) ).toEqual( [
		screen.getByRole( 'tab', { name: 'First · Database', selected: true } ),
		admin,
	] );
} );

it( 'closes all panes in the selected split and leaves unselected tabs open', async () => {
	const { connector } = await setup();
	await addTab( 'Admin' );
	await addTab( 'Database' );
	await addTab( 'Email log' );
	const [ browser, admin, database, email ] = screen.getAllByRole( 'tab' );
	await user.click( admin );
	await split( database );
	const paired = screen.getByRole( 'tab', { name: 'Admin · Database' } );
	fireEvent.click( email, { shiftKey: true } );
	expect( screen.getAllByRole( 'tab', { selected: true } ) ).toEqual( [ paired, email ] );
	fireEvent.contextMenu( paired );
	await user.click( await screen.findByRole( 'menuitem', { name: /^Close tabs$/ } ) );
	expect( screen.getAllByRole( 'tab' ) ).toEqual( [ browser ] );
	expect( screen.queryByRole( 'group', { name: 'Split view' } ) ).not.toBeInTheDocument();
	expect( connector.stopSite ).not.toHaveBeenCalled();
	await waitFor( () => expect( browser ).toHaveFocus() );
} );

it( 'closes an email pane from the split and restores the remaining browser tab', async () => {
	await setup();
	await addTab( 'Email log' );
	const email = screen.getByRole( 'tab', { name: 'Email log' } );
	await split( email );
	const pane = screen.getByRole( 'complementary', { name: 'Second panel' } );
	await user.click( within( pane ).getByRole( 'button', { name: 'Close tab' } ) );
	expect( screen.getAllByRole( 'tab' ) ).toEqual( [
		screen.getByRole( 'tab', { name: 'First' } ),
	] );
	expect( screen.getByRole( 'button', { name: 'Browser options' } ) ).toBeInTheDocument();
} );

it( 'adds a third tab to the open split and keeps the other two when it closes', async () => {
	await setup();
	await addTab( 'Database' );
	const [ first, database ] = screen.getAllByRole( 'tab' );
	await user.click( first );
	await split( database );
	await addTab( 'Email log' );
	const email = screen.getByRole( 'tab', { name: 'Email log' } );
	await user.click( screen.getByRole( 'tab', { name: 'First · Database' } ) );
	const frames = new Set( document.querySelectorAll( 'iframe' ) );
	fireEvent.contextMenu( email );
	await user.click( await screen.findByRole( 'menuitem', { name: 'Open as split' } ) );
	const splitView = screen.getByRole( 'group', { name: 'Split view' } );
	expect( within( splitView ).getAllByRole( 'complementary' ) ).toHaveLength( 3 );
	expect( within( splitView ).getAllByRole( 'separator' ) ).toHaveLength( 2 );
	expect( screen.getAllByRole( 'tab' ) ).toEqual( [
		screen.getByRole( 'tab', { name: 'First · Database · Email log', selected: true } ),
	] );
	expect( new Set( document.querySelectorAll( 'iframe' ) ) ).toEqual( frames );
	const pane = within( splitView ).getByRole( 'complementary', { name: 'Panel 3' } );
	await user.click( within( pane ).getByRole( 'button', { name: 'Close tab' } ) );
	expect( within( splitView ).getAllByRole( 'complementary' ) ).toHaveLength( 2 );
	expect(
		screen.getByRole( 'tab', { name: 'First · Database', selected: true } )
	).toBeInTheDocument();
} );

it( 'remembers the responsive preview when switching tabs', async () => {
	await setup();
	await addTab( 'Admin' );
	const source = screen.getByRole( 'tab', { name: 'First' } );
	await user.click( source );
	await showDeviceToolbar();
	expect( source ).toHaveAttribute( 'aria-selected', 'true' );
	expect( screen.getAllByRole( 'tab' ) ).toHaveLength( 2 );
	expect( screen.getByRole( 'toolbar', { name: 'Responsive preview' } ) ).toBeInTheDocument();
	await user.click( screen.getByRole( 'tab', { name: 'Admin' } ) );
	expect( screen.queryByRole( 'toolbar', { name: 'Responsive preview' } ) ).not.toBeInTheDocument();
	await user.click( source );
	expect( screen.getByRole( 'toolbar', { name: 'Responsive preview' } ) ).toBeInTheDocument();
} );

function pointer( type: string, x: number, y: number ) {
	const event = new MouseEvent( type, {
		bubbles: true,
		cancelable: true,
		button: 0,
		clientX: x,
		clientY: y,
	} );
	Object.defineProperty( event, 'pointerId', { value: 1 } );
	return event;
}

it.each( [ 'left', 'right', 'cancel' ] as const )(
	'reveals both split targets and handles %s without reloading pages',
	async ( action ) => {
		await setup();
		await addTab( 'Database' );
		const tabs = screen.getAllByRole( 'tab' );
		const sourceId =
			tabs[ 0 ].closest< HTMLElement >( '[data-tab-reorder-id]' )!.dataset.tabReorderId;
		const pages = Array.from( document.querySelectorAll( 'iframe' ) );
		vi.spyOn( HTMLElement.prototype, 'getBoundingClientRect' ).mockImplementation( function (
			this: HTMLElement
		) {
			if ( this.hasAttribute( 'data-preview-workspace' ) ) return new DOMRect( 300, 0, 1100, 800 );
			if ( this.hasAttribute( 'data-preview-viewport' ) ) return new DOMRect( 300, 100, 1100, 700 );
			if ( this.getAttribute( 'role' ) === 'tablist' ) return new DOMRect( 350, 4, 324, 32 );
			const index = tabs.findIndex( ( tab ) => tab.closest( '[data-tab-reorder-id]' ) === this );
			return new DOMRect( 350 + Math.max( 0, index ) * 162, 4, 160, 32 );
		} );
		const getTargets = () =>
			screen
				.getAllByText( 'Drop to split' )
				.map( ( label ) => label.closest< HTMLElement >( '[data-variant="panel"]' )! );
		fireEvent( tabs[ 0 ], pointer( 'pointerdown', 370, 20 ) );
		fireEvent( window, pointer( 'pointermove', 1350, 70 ) );
		const targets = getTargets();
		expect( targets ).toHaveLength( 2 );
		for ( const target of targets ) {
			expect( target.parentElement ).toHaveAttribute( 'data-visible' );
			expect( target ).not.toHaveAttribute( 'data-active' );
		}
		expect( targets[ 0 ].parentElement!.style.width ).toBe(
			targets[ 1 ].parentElement!.style.width
		);
		expect( targets[ 0 ].parentElement!.style.height ).toBe(
			targets[ 1 ].parentElement!.style.height
		);
		fireEvent( window, pointer( 'pointerup', 1350, 70 ) );
		expect( screen.queryByRole( 'group', { name: 'Split view' } ) ).not.toBeInTheDocument();
		fireEvent( tabs[ 0 ], pointer( 'pointerdown', 370, 20 ) );
		fireEvent( window, pointer( 'pointermove', 350, 350 ) );
		expect( getTargets()[ 0 ] ).toHaveAttribute( 'data-active' );
		expect( getTargets()[ 1 ] ).not.toHaveAttribute( 'data-active' );
		fireEvent( window, pointer( 'pointermove', 1350, 350 ) );
		expect( getTargets()[ 0 ] ).not.toHaveAttribute( 'data-active' );
		expect( getTargets()[ 1 ] ).toHaveAttribute( 'data-active' );
		fireEvent( window, pointer( 'pointermove', 1050, 350 ) );
		for ( const target of getTargets() ) expect( target ).not.toHaveAttribute( 'data-active' );
		const x = action === 'left' ? 350 : 1350;
		fireEvent( window, pointer( 'pointermove', x, 350 ) );
		if ( action !== 'cancel' ) {
			fireEvent( window, pointer( 'pointerup', x, 350 ) );
			expect( await screen.findByRole( 'group', { name: 'Split view' } ) ).toBeInTheDocument();
			expect(
				screen
					.getByRole( 'complementary', {
						name: action === 'left' ? 'First panel' : 'Second panel',
					} )
					.closest( '[data-preview-pane-id]' )
			).toHaveAttribute( 'data-preview-pane-id', sourceId );
		} else {
			fireEvent.keyDown( window, { key: 'Escape' } );
			await waitFor( () =>
				expect( document.querySelector( '[data-tab-drag-preview]' ) ).toBeNull()
			);
			expect( screen.queryByRole( 'group', { name: 'Split view' } ) ).not.toBeInTheDocument();
			expect( screen.getAllByRole( 'tab' ) ).toEqual( tabs );
		}
		expect( new Set( document.querySelectorAll( 'iframe' ) ) ).toEqual( new Set( pages ) );
	}
);

it( 'keeps a paired tab drag in the strip and can still reorder both tabs together', async () => {
	await setup();
	await addTab( 'Database' );
	await user.click( screen.getByRole( 'tab', { name: 'First' } ) );
	await split( screen.getByRole( 'tab', { name: 'Database' } ) );
	await addTab( 'Email log' );
	await user.click( screen.getByRole( 'tab', { name: 'First · Database' } ) );
	const [ pairedTab, email ] = screen.getAllByRole( 'tab' );
	const list = screen.getByRole( 'tablist', { name: 'Preview tabs' } );
	const pair = list.querySelector( '[data-preview-tab-pair]' )!;
	expect( pair ).toContainElement( pairedTab );
	expect( pair ).not.toContainElement( email );
	const original = HTMLElement.prototype.getBoundingClientRect;
	vi.spyOn( HTMLElement.prototype, 'getBoundingClientRect' ).mockImplementation( function (
		this: HTMLElement
	) {
		if ( this === list ) return new DOMRect( 350, 4, 364, 36 );
		if ( this === pair ) return new DOMRect( 350, 4, 200, 36 );
		if ( this === email.closest( '[data-tab-reorder-id]' ) ) return new DOMRect( 554, 6, 160, 32 );
		return original.call( this );
	} );
	const pages = new Set( document.querySelectorAll( 'iframe' ) );

	fireEvent( pairedTab, pointer( 'pointerdown', 500, 20 ) );
	fireEvent( window, pointer( 'pointermove', 1350, 300 ) );
	expect( document.querySelector( '[data-tab-drag-preview]' ) ).toBeNull();
	expect( screen.queryByText( 'Drop to split' ) ).not.toBeInTheDocument();
	fireEvent( window, pointer( 'pointerup', 1350, 300 ) );
	expect( screen.getAllByRole( 'tab' ) ).toEqual( [ pairedTab, email ] );

	fireEvent( pairedTab, pointer( 'pointerdown', 375, 20 ) );
	fireEvent( window, pointer( 'pointermove', 690, 20 ) );
	const chip = document.querySelector< HTMLElement >( '[data-tab-drag-preview]' )!;
	expect( chip ).toHaveTextContent( 'FirstDatabase' );
	expect( chip ).not.toHaveAttribute( 'data-landing' );
	fireEvent( window, pointer( 'pointermove', 1350, 300 ) );
	expect( chip ).not.toHaveAttribute( 'data-landing' );
	expect( chip ).toHaveStyle( { transform: 'translate3d(514px, 4px, 0)' } );
	expect( screen.queryByText( 'Drop to split' ) ).not.toBeInTheDocument();
	fireEvent( window, pointer( 'pointerup', 690, 20 ) );
	expect( screen.getAllByRole( 'tab' ).map( ( tab ) => tab.textContent ) ).toEqual( [
		'Email log',
		'FirstDatabase',
	] );
	expect( screen.getByRole( 'group', { name: 'Split view' } ) ).toBeInTheDocument();
	expect( new Set( document.querySelectorAll( 'iframe' ) ) ).toEqual( pages );
} );

it( 'tracks focus between embedded pages without another host blur event', async () => {
	await setup();
	await addTab();
	const tabs = screen.getAllByRole( 'tab' );
	fireEvent.click( tabs[ 0 ] );
	await split( tabs[ 1 ] );
	const first = screen
		.getByRole( 'complementary', { name: 'First panel' } )
		.querySelector( 'iframe' )!;
	const activeElement = vi.spyOn( document, 'activeElement', 'get' ).mockReturnValue( first );
	fireEvent.blur( window );
	await waitFor( () =>
		expect( first.closest( '[data-preview-pane-id]' ) ).toHaveAttribute( 'data-active-tab' )
	);
	const second = screen
		.getByRole( 'complementary', { name: 'Second panel' } )
		.querySelector( 'iframe' )!;
	activeElement.mockReturnValue( second );
	await waitFor( () =>
		expect( second.closest( '[data-preview-pane-id]' ) ).toHaveAttribute( 'data-active-tab' )
	);
} );

it( 'shares one annotation trigger and drawing toolbar across both panes', async () => {
	Object.defineProperty( window.navigator, 'userAgent', {
		value: `${ REAL_USER_AGENT } Electron/44.0.0`,
		configurable: true,
	} );
	const { siteId } = await setup();
	await addTab();
	const tabs = screen.getAllByRole( 'tab' );
	await user.click( tabs[ 0 ] );
	await split( tabs[ 1 ] );
	const panes = [
		screen.getByRole( 'complementary', { name: 'First panel' } ),
		screen.getByRole( 'complementary', { name: 'Second panel' } ),
	];
	const annotation = screen.getByRole( 'button', { name: 'Annotate' } );
	expect( document.querySelector( '[data-site-header-actions]' ) ).toContainElement( annotation );
	for ( const pane of panes ) {
		expect( pane ).not.toContainElement( annotation );
		expect( within( pane ).getByRole( 'button', { name: 'Browser options' } ) ).toBeVisible();
		expect( within( pane ).getByRole( 'button', { name: 'Close tab' } ) ).toBeVisible();
	}
	const inspectors = panes.map( ( pane, index ) => {
		const webview = pane.querySelector( 'webview' )!;
		const run = vi.fn( async () => undefined );
		Object.assign( webview, { executeJavaScript: run, getWebContentsId: () => 42 + index } );
		return {
			run,
			onPage: () => fireEvent( webview, new Event( 'dom-ready' ) ),
			onLog: ( message: string ) =>
				fireEvent( webview, Object.assign( new Event( 'console-message' ), { message } ) ),
		};
	} );
	await act( async () => {
		inspectors.forEach( ( { onPage } ) => onPage() );
	} );
	fireEvent.pointerDown( panes[ 1 ] );
	await user.click( annotation );
	expect( getSiteAnnotations( siteId ).active ).toBe( true );
	expect( panes[ 1 ].closest( '[data-preview-pane-id]' ) ).toHaveAttribute( 'data-active-tab' );
	expect( screen.getByRole( 'button', { name: 'Annotate' } ) ).toBe( annotation );
	inspectors.forEach( ( { run } ) =>
		expect( run ).toHaveBeenCalledWith( expect.stringContaining( INSPECTOR_PAGE_SCRIPT ), false )
	);
	const toolbar = screen.getByRole( 'group', { name: 'Annotation tools' } );
	expect( panes[ 0 ] ).not.toContainElement( toolbar );
	expect( panes[ 1 ] ).not.toContainElement( toolbar );
	for ( const { run } of inspectors ) {
		expect( run ).toHaveBeenLastCalledWith( expect.stringContaining( '"active":true' ), false );
		run.mockClear();
	}
	fireEvent.keyDown( screen.getByRole( 'separator', { name: 'Resize split view' } ), {
		key: 'ArrowRight',
	} );
	for ( const { run } of inspectors ) expect( run ).not.toHaveBeenCalled();
	await act( async () =>
		inspectors[ 1 ].onLog(
			INSPECTOR_BRIDGE_PREFIX + JSON.stringify( { type: 'annotation-tool', tool: 'draw' } )
		)
	);
	expect( panes[ 1 ].closest( '[data-preview-pane-id]' ) ).toHaveAttribute( 'data-active-tab' );
	for ( const { run } of inspectors ) {
		expect( run ).toHaveBeenLastCalledWith( expect.stringContaining( '"tool":"draw"' ), false );
	}
	expect( screen.getByRole( 'group', { name: 'Annotation tools' } ) ).toBe( toolbar );

	await user.click( within( toolbar ).getByRole( 'button', { name: 'Select' } ) );
	await act( async () =>
		inspectors[ 1 ].onLog(
			INSPECTOR_BRIDGE_PREFIX +
				JSON.stringify( {
					type: 'pick',
					target: {
						url: 'http://localhost:9010/',
						path: '/',
						selector: 'h1',
						tag: 'h1',
						nearbyText: 'Moire',
					},
					anchor: { left: 20, top: 20 },
				} )
		)
	);
	const note = getSiteAnnotations( siteId ).notes[ 0 ];
	expect( inspectors[ 0 ].run ).not.toHaveBeenLastCalledWith(
		expect.stringContaining( note.id ),
		false
	);
	expect( inspectors[ 1 ].run ).toHaveBeenLastCalledWith(
		expect.stringContaining( note.id ),
		false
	);
	fireEvent.pointerDown( panes[ 0 ] );
	expect( screen.getByRole( 'button', { name: 'Annotate' } ) ).toBe( annotation );
	expect( screen.getByRole( 'group', { name: 'Annotation tools' } ) ).toBe( toolbar );
	expect(
		within( panes[ 1 ] ).getByRole( 'textbox', { name: 'Describe the change' } )
	).toBeVisible();
	act( () => {
		changeAnnotation( siteId, note.id, { comment: 'Change the mobile heading' } );
		stageAnnotations( siteId, [ note.id ], true );
	} );
	await addTab( 'Email log' );
	act( () => requestAnnotationReview( siteId, note.id ) );
	expect( await screen.findByRole( 'group', { name: 'Split view' } ) ).toBeVisible();
	expect( panes[ 1 ].closest( '[data-preview-pane-id]' ) ).toHaveAttribute( 'data-active-tab' );
} );

it( 'reorders a pair together with the keyboard without remounting its pages', async () => {
	await setup();
	await addTab( 'Database' );
	const tabs = screen.getAllByRole( 'tab' );
	fireEvent.click( tabs[ 0 ] );
	await split( tabs[ 1 ] );
	await addTab( 'Email log' );
	const pages = Array.from( document.querySelectorAll( 'iframe' ) );
	const pairedTab = screen.getByRole( 'tab', { name: 'First · Database' } );
	await user.click( pairedTab );
	fireEvent.keyDown( pairedTab, {
		key: 'ArrowRight',
		altKey: true,
		shiftKey: true,
	} );
	expect( screen.getAllByRole( 'tab' ).map( ( tab ) => tab.textContent ) ).toEqual( [
		'Email log',
		'FirstDatabase',
	] );
	expect( new Set( document.querySelectorAll( 'iframe' ) ) ).toEqual( new Set( pages ) );
	expect( screen.getByRole( 'group', { name: 'Split view' } ) ).toBeInTheDocument();
} );

it.each( [ 'Design System', 'Email log' ] )(
	'keeps %s annotations in their owning pane',
	async ( tool ) => {
		const { siteId } = await setup( ( connector, siteId ) => {
			connector.getSiteDesign.mockResolvedValue( {
				design:
					'---\nname: Pane test\ncolors:\n  primary: "#3858e9"\n  background: "#ffffff"\ntypography:\n  body:\n    fontFamily: system-ui\n    fontSize: 16px\n---',
				themeJson: {},
			} );
			connector.state.emails[ siteId ] = [
				{
					id: 'message.eml',
					subject: 'Message to review',
					from: { name: 'WordPress', address: 'wordpress@localhost' },
					to: [ { name: '', address: 'demo@example.com' } ],
					cc: [],
					replyTo: [],
					date: '2026-11-28T10:00:00Z',
					html: null,
					text: 'Message to annotate',
					source: 'Message to annotate',
					attachments: [],
				},
			];
		} );
		await addTab( tool );
		await addTab( tool );
		await split( screen.getAllByRole( 'tab' ).at( -1 )! );
		const first = screen.getByRole( 'complementary', { name: 'First panel' } );
		const second = screen.getByRole( 'complementary', { name: 'Second panel' } );
		if ( tool === 'Email log' ) {
			for ( const pane of [ first, second ] ) {
				await user.click(
					await within( pane ).findByRole( 'option', { name: /Message to review/ } )
				);
				await within( pane ).findByRole( 'article' );
			}
		}
		act( () => setAnnotating( siteId, true ) );
		await user.click(
			await within( first ).findByText(
				tool === 'Design System' ? 'Pane test' : 'Message to annotate'
			)
		);
		const note = getSiteAnnotations( siteId ).notes[ 0 ];
		expect( note.previewPaneId ).toBe(
			first.closest< HTMLElement >( '[data-preview-pane-id]' )!.dataset.previewPaneId
		);
		expect(
			within( first ).getByText( '1', { selector: 'span[aria-hidden="true"]' } )
		).toBeVisible();
		expect(
			within( second ).queryByText( '1', { selector: 'span[aria-hidden="true"]' } )
		).not.toBeInTheDocument();
		fireEvent.pointerDown( second );
		expect( within( first ).getByRole( 'textbox', { name: 'Describe the change' } ) ).toBeVisible();
		expect(
			within( second ).queryByRole( 'textbox', { name: 'Describe the change' } )
		).not.toBeInTheDocument();
	}
);
