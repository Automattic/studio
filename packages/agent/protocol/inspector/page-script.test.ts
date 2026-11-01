import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	INSPECTOR_BRIDGE_PREFIX,
	INSPECTOR_COMMAND_EVENT,
	INSPECTOR_PAGE_SCRIPT,
	parseInspectorMessage,
} from '@studio/agent/protocol/inspector/page-script';

function mount() {
	const log = vi.spyOn( console, 'log' ).mockImplementation( () => undefined );
	vi.stubGlobal( 'requestAnimationFrame', () => 0 );
	vi.stubGlobal( 'CSS', { escape: ( value: string ) => value } );
	vi.stubGlobal(
		'ResizeObserver',
		class {
			observe() {}
			disconnect() {}
		}
	);
	new Function( INSPECTOR_PAGE_SCRIPT )();
	return () =>
		log.mock.calls.map( ( [ message ] ) => parseInspectorMessage( message ) ).filter( Boolean );
}

function publish( state: Record< string, unknown > ) {
	window.dispatchEvent(
		new CustomEvent( INSPECTOR_COMMAND_EVENT, {
			detail: {
				notes: [],
				editingId: null,
				annotationLabel: 'Annotation',
				pendingAnnotationLabel: 'Pending annotation',
				accent: '#3858e9',
				...state,
			},
		} )
	);
}

describe( 'annotation inspector', () => {
	afterEach( () => {
		( window as Window & { __studioInspectorDispose?: () => void } ).__studioInspectorDispose?.();
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
		document.body.replaceChildren();
	} );

	it( 'reports the picked element and draws a marker for each note on the page', () => {
		document.body.innerHTML = '<h1 class="hero">Welcome</h1>';
		const heading = document.querySelector( 'h1' ) as HTMLElement;
		vi.spyOn( heading, 'getBoundingClientRect' ).mockReturnValue( new DOMRect( 10, 20, 200, 40 ) );
		const events = mount();
		publish( { active: true } );

		const click = new MouseEvent( 'click', {
			bubbles: true,
			cancelable: true,
			clientX: 110,
			clientY: 30,
		} );
		heading.dispatchEvent( click );

		expect( click.defaultPrevented ).toBe( true );
		expect( events() ).toEqual( [
			{
				type: 'pick',
				anchor: { left: 110, top: 30 },
				target: expect.objectContaining( {
					selector: 'body > h1.hero',
					tag: 'h1',
					nearbyText: 'Welcome',
					point: { x: 0.5, y: 0.25 },
				} ),
			},
		] );

		publish( {
			active: true,
			notes: [ { id: 'n1', number: 1, selector: 'body > h1.hero', url: location.href } ],
		} );
		const root = ( document.getElementById( '__studio-inspector-host' ) as HTMLElement )
			.shadowRoot as ShadowRoot;
		const markers = Array.from( root.querySelectorAll( 'button' ) );
		expect( markers.map( ( marker ) => marker.textContent ) ).toEqual( [ '1' ] );
		markers[ 0 ].click();
		expect( events().at( -1 ) ).toMatchObject( { type: 'edit', id: 'n1' } );
	} );

	it( 'keeps marker colors separate from the selection highlight and supports older hosts', () => {
		mount();
		publish( {
			accent: '#aabbff',
			onAccent: '#141414',
			markerAccent: '#3858e9',
			onMarkerAccent: '#ffffff',
		} );
		const host = document.getElementById( '__studio-inspector-host' ) as HTMLElement;
		expect( host.style.getPropertyValue( '--accent' ) ).toBe( '#aabbff' );
		expect( host.style.getPropertyValue( '--on-accent' ) ).toBe( '#ffffff' );
		expect( decodeURIComponent( host.style.getPropertyValue( '--marker' ) ) ).toContain(
			'fill="#3858e9"'
		);

		publish( { accent: '#3858e9', onAccent: '#ffffff' } );
		expect( host.style.getPropertyValue( '--on-accent' ) ).toBe( '#ffffff' );
		expect( decodeURIComponent( host.style.getPropertyValue( '--marker' ) ) ).toContain(
			'fill="#3858e9"'
		);
	} );

	it.each( [ 0, -20 ] )( 'keeps the highlight flush with the viewport at x=%s', ( left ) => {
		document.body.innerHTML = '<header>Welcome</header>';
		const header = document.querySelector( 'header' ) as HTMLElement;
		vi.spyOn( header, 'getBoundingClientRect' ).mockReturnValue(
			new DOMRect( left, 0, innerWidth - left, 40 )
		);
		mount();
		publish( { active: true } );
		header.dispatchEvent( new MouseEvent( 'click', { bubbles: true, clientX: 10, clientY: 10 } ) );
		publish( { active: true } );
		const highlight = document
			.getElementById( '__studio-inspector-host' )
			?.shadowRoot?.querySelector( '.highlight' );
		expect( highlight ).toBeVisible();
		expect( highlight ).toHaveStyle( { left: '0px', top: '0px', width: `${ innerWidth }px` } );
	} );

	it( 'keeps the crosshair centered on edge picks and changes the same marker on Save', () => {
		document.body.innerHTML = '<h1>Welcome</h1>';
		const heading = document.querySelector( 'h1' ) as HTMLElement;
		const bounds = vi
			.spyOn( heading, 'getBoundingClientRect' )
			.mockReturnValue( new DOMRect( 0, 20, innerWidth, 40 ) );
		const events = mount();
		const note = {
			id: 'draft',
			number: 3,
			selector: 'h1',
			url: location.href,
			point: { x: 2 / innerWidth, y: 0.25 },
			pending: true,
		};
		const update = ( pending: boolean, editingId: string | null = null ) =>
			publish( { active: true, notes: [ { ...note, pending } ], editingId } );
		update( true, note.id );
		const host = document.getElementById( '__studio-inspector-host' ) as HTMLElement;
		const root = host.shadowRoot as ShadowRoot;
		const marker = root.querySelector( 'button' ) as HTMLButtonElement;
		expect( getComputedStyle( heading ).cursor ).toBe( 'crosshair' );
		expect( marker ).toHaveAttribute( 'aria-label', 'Pending annotation' );
		expect( marker ).toHaveAttribute( 'data-pending', 'true' );
		expect( marker ).toHaveStyle( { left: '2px' } );
		expect( marker ).toHaveStyle( { top: '30px' } );
		marker.dispatchEvent( new Event( 'animationend' ) );
		marker.focus();

		update( false );
		expect( root.querySelector( 'button' ) ).toBe( marker );
		expect( root.activeElement ).toBe( marker );
		expect( marker ).toHaveAttribute( 'data-pending', 'false' );
		expect( marker ).toHaveAttribute( 'aria-label', 'Annotation 3' );
		expect( marker.querySelector( '.number' )?.textContent ).toBe( '3' );
		expect( marker ).not.toHaveClass( 'enter' );
		expect( marker ).toHaveClass( 'confirm' );
		marker.dispatchEvent( new Event( 'animationend' ) );
		expect( marker ).not.toHaveClass( 'confirm' );

		update( false, note.id );
		expect( marker ).toHaveAttribute( 'data-pending', 'false' );
		expect( marker ).not.toHaveClass( 'confirm' );
		bounds.mockReturnValue( new DOMRect( innerWidth - 4, 10, innerWidth, 40 ) );
		vi.stubGlobal( 'requestAnimationFrame', ( callback: FrameRequestCallback ) => {
			callback( 0 );
			return 0;
		} );
		document.dispatchEvent( new Event( 'scroll' ) );
		heading.dispatchEvent( new MouseEvent( 'pointermove', { bubbles: true } ) );
		expect( root.querySelector( 'button' ) ).toBe( marker );
		expect( root.activeElement ).toBe( marker );
		expect( marker ).toHaveStyle( { left: `${ innerWidth - 2 }px` } );
		expect( marker ).toHaveStyle( { top: '20px' } );
		marker.click();
		expect( events().at( -1 ) ).toEqual( {
			type: 'edit',
			id: note.id,
			anchor: { left: innerWidth - 2, top: 20 },
		} );
		publish( { active: false, notes: [ note ] } );
		expect( getComputedStyle( heading ).cursor ).not.toBe( 'crosshair' );
		expect( host.hidden ).toBe( true );
		update( false );
		expect( root.querySelector( 'button' ) ).toBe( marker );
		expect( marker ).not.toHaveClass( 'enter' );
		publish( { active: false } );
		expect( marker.isConnected ).toBe( false );
	} );

	it( 'preserves a dismissed draft marker and removes only deleted or off-page notes', () => {
		document.body.innerHTML = '<h1>Welcome</h1>';
		mount();
		const note = { id: 'draft', number: 1, pending: true, selector: 'h1', url: location.href };
		publish( { active: true, notes: [ note ], editingId: note.id } );
		const root = document.getElementById( '__studio-inspector-host' )!.shadowRoot!;
		const marker = root.querySelector( 'button' );
		publish( {
			active: true,
			notes: [
				note,
				{ ...note, id: 'other', number: 2 },
				{ ...note, id: 'away', url: 'https://example.com/' },
			],
		} );
		expect( root.querySelectorAll( 'button' ) ).toHaveLength( 2 );
		expect( root.querySelector( 'button' ) ).toBe( marker );
		expect( marker ).toHaveAttribute( 'data-pending', 'true' );
		publish( { active: true, notes: [ note ] } );
		expect( root.querySelectorAll( 'button' ) ).toHaveLength( 1 );
		expect( root.querySelector( 'button' ) ).toBe( marker );
	} );

	it( "ignores clicks in the host's own UI", () => {
		document.body.innerHTML = '<div data-studio-inspector><button>Send</button></div>';
		const events = mount();
		publish( { active: true } );

		const click = new MouseEvent( 'click', { bubbles: true, cancelable: true } );
		document.querySelector( 'button' )?.dispatchEvent( click );

		expect( click.defaultPrevented ).toBe( false );
		expect( events() ).toEqual( [] );
	} );

	it( 'leaves the page alone outside annotation mode but forwards browser shortcuts', () => {
		document.body.innerHTML = '<a href="#next">Next</a>';
		const events = mount();
		publish( { active: false } );

		const click = new MouseEvent( 'click', { bubbles: true, cancelable: true } );
		document.querySelector( 'a' )?.dispatchEvent( click );
		document.dispatchEvent(
			new KeyboardEvent( 'keydown', { key: 'r', ctrlKey: true, metaKey: true, bubbles: true } )
		);

		expect( click.defaultPrevented ).toBe( false );
		expect( events() ).toEqual( [ { type: 'browser-command', command: 'reload' } ] );
	} );
} );

describe( 'parseInspectorMessage', () => {
	const message = ( data: unknown ) => INSPECTOR_BRIDGE_PREFIX + JSON.stringify( data );

	it( 'moves anchors into host coordinates', () => {
		expect(
			parseInspectorMessage( message( { type: 'edit', id: 'n1', anchor: { left: 5, top: 6 } } ), {
				left: 100,
				top: 50,
			} )
		).toEqual( { type: 'edit', id: 'n1', anchor: { left: 105, top: 56 } } );
	} );

	it( 'keeps only well-formed, bounded target fields', () => {
		const parsed = parseInspectorMessage(
			message( {
				type: 'pick',
				anchor: { left: 0, top: 0 },
				target: { selector: 'h1', tag: 'h1', nearbyText: 'x'.repeat( 5000 ), extra: 'dropped' },
			} )
		);
		expect( parsed ).toMatchObject( { type: 'pick', target: { selector: 'h1', tag: 'h1' } } );
		expect( parsed?.type === 'pick' && parsed.target.nearbyText ).toHaveLength( 1000 );
		expect( parsed ).not.toHaveProperty( 'target.extra' );
	} );

	it.each( [
		'plain page output',
		message( { type: 'pick', anchor: { left: 0, top: 0 }, target: { tag: 'h1' } } ),
		message( { type: 'browser-command', command: 'close' } ),
		INSPECTOR_BRIDGE_PREFIX + '{',
		message( { type: 'escape', padding: 'x'.repeat( 100_000 ) } ),
	] )( 'ignores %s', ( value ) => {
		expect( parseInspectorMessage( value ) ).toBeNull();
	} );
} );
