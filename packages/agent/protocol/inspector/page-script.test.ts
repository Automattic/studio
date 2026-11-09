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
	vi.stubGlobal( 'matchMedia', () => ( { matches: false } ) );
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

function pointer( element: Element, type: string, x: number, y: number, pointerId = 1 ) {
	const event = new MouseEvent( type, {
		bubbles: true,
		cancelable: true,
		clientX: x,
		clientY: y,
	} );
	Object.defineProperty( event, 'pointerId', { value: pointerId } );
	element.dispatchEvent( event );
}

describe( 'annotation inspector', () => {
	afterEach( () => {
		( window as Window & { __studioInspectorDispose?: () => void } ).__studioInspectorDispose?.();
		vi.useRealTimers();
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

	it.each( [
		[ 20, 30, 220, 130 ],
		[ 220, 130, 20, 30 ],
	] )(
		'keeps a rectangle from (%s, %s) to (%s, %s) when preview focus releases capture',
		( x, y, endX, endY ) => {
			document.body.innerHTML = '<h1>Welcome</h1><p>Other content</p>';
			const events = mount();
			publish( { active: true, areaSelection: true } );
			pointer( document.body, 'pointerdown', x, y );
			pointer( document.documentElement, 'lostpointercapture', x, y );
			pointer( document.documentElement, 'pointermove', endX, endY );
			pointer( document.documentElement, 'pointerup', endX, endY );
			document.body.click();
			expect( events() ).toEqual( [
				{
					type: 'selection',
					selection: expect.objectContaining( {
						target: expect.objectContaining( {
							kind: 'region',
							url: location.href,
							documentRect: { left: 20, top: 30, width: 200, height: 100 },
						} ),
						rect: { left: 20, top: 30, width: 200, height: 100 },
					} ),
				},
			] );
		}
	);

	it( 'keeps clicks as element picks despite small pointer movement', () => {
		document.body.innerHTML = '<h1>Welcome</h1>';
		const events = mount();
		publish( { active: true, areaSelection: true } );
		const heading = document.querySelector( 'h1' )!;
		pointer( heading, 'pointerdown', 30, 40 );
		pointer( document.documentElement, 'pointerup', 32, 42 );
		heading.click();
		expect( events() ).toHaveLength( 1 );
		expect( events()[ 0 ] ).toMatchObject( { type: 'pick', target: { tag: 'h1' } } );
	} );

	it( 'releases failed selections without clearing a newer capture or disabling annotation', () => {
		const events = mount();
		publish( { active: true, areaSelection: true } );
		const selectArea = () => {
			pointer( document.body, 'pointerdown', 20, 30 );
			pointer( document.documentElement, 'pointerup', 220, 130 );
		};
		const canScroll = () =>
			document.dispatchEvent( new WheelEvent( 'wheel', { cancelable: true } ) );
		const clear = ( id: string ) =>
			window.dispatchEvent(
				new CustomEvent( INSPECTOR_COMMAND_EVENT, { detail: { clearSelection: id } } )
			);
		const host = document.getElementById( '__studio-inspector-host' )!;
		selectArea();
		const firstId = host.dataset.captureId!;
		expect( firstId ).toBeTruthy();
		expect( canScroll() ).toBe( false );

		clear( firstId );
		expect( host ).not.toHaveAttribute( 'data-capture-id' );
		expect( canScroll() ).toBe( true );

		selectArea();
		const nextId = host.dataset.captureId!;
		expect( nextId ).toBeTruthy();
		expect( events().filter( ( event ) => event?.type === 'selection' ) ).toHaveLength( 2 );
		clear( firstId );
		expect( host ).toHaveAttribute( 'data-capture-id', nextId );
		expect( canScroll() ).toBe( false );
		clear( nextId );
		expect( canScroll() ).toBe( true );
	} );

	it.each( [ 'pointercancel', 'blur', 'scroll', 'resize', 'escape' ] )(
		'cancels a rectangle on %s',
		( cause ) => {
			const events = mount();
			publish( { active: true, areaSelection: true } );
			pointer( document.body, 'pointerdown', 20, 30 );
			pointer( document.documentElement, 'pointermove', 220, 130 );
			if ( cause === 'escape' ) {
				document.dispatchEvent( new KeyboardEvent( 'keydown', { key: 'Escape', bubbles: true } ) );
			} else if ( cause === 'pointercancel' ) {
				pointer( document.documentElement, cause, 220, 130 );
			} else {
				( cause === 'scroll' ? document : window ).dispatchEvent( new Event( cause ) );
			}
			pointer( document.documentElement, 'pointerup', 220, 130 );
			document.body.click();
			expect( events() ).toEqual( [] );
		}
	);

	it( 'does not start rectangle gestures without the host capability or while busy', () => {
		const events = mount();
		for ( const state of [ { active: true }, { active: true, areaSelection: true, busy: true } ] ) {
			publish( state );
			pointer( document.body, 'pointerdown', 20, 30 );
			pointer( document.documentElement, 'pointerup', 220, 130 );
		}
		expect( events() ).toEqual( [] );
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

	it( 'keeps edge markers inside the viewport and changes the same marker on Save', () => {
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
		expect( marker ).toHaveStyle( { left: '24px' } );
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
		expect( marker ).toHaveStyle( { left: `${ innerWidth - 24 }px` } );
		expect( marker ).toHaveStyle( { top: '24px' } );
		marker.click();
		expect( events().at( -1 ) ).toEqual( {
			type: 'edit',
			id: note.id,
			anchor: { left: innerWidth - 24, top: 24 },
		} );
		bounds.mockReturnValue( new DOMRect( 100, innerHeight - 14, innerWidth, 40 ) );
		update( false, note.id );
		expect( marker ).toHaveStyle( { top: `${ innerHeight - 24 }px` } );
		expect( marker.hidden ).toBe( false );
		bounds.mockReturnValue( new DOMRect( 100, -100, innerWidth, 40 ) );
		update( false, note.id );
		expect( marker.hidden ).toBe( true );
		expect( events().at( -1 ) ).toEqual( { type: 'anchor', id: note.id, anchor: null } );
		publish( { active: false, notes: [ note ] } );
		expect( getComputedStyle( heading ).cursor ).not.toBe( 'crosshair' );
		expect( host.hidden ).toBe( true );
		expect( getComputedStyle( host ).display ).toBe( 'none' );
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
		const host = document.getElementById( '__studio-inspector-host' )!;
		publish( { active: false, notes: [ note ] } );
		expect( host.inert ).toBe( true );
		expect( marker ).toHaveClass( 'leave' );
		publish( { active: true, notes: [ note ] } );
		expect( marker ).toHaveClass( 'enter' );
		expect( marker ).not.toHaveClass( 'leave' );
		publish( { active: false, notes: [ note ] } );
		const end = new Event( 'animationend' );
		Object.defineProperty( end, 'animationName', { value: 'marker-out' } );
		marker!.dispatchEvent( end );
		expect( getComputedStyle( host ).display ).toBe( 'none' );
		expect( root.querySelector( 'button' ) ).toBe( marker );
		publish( { active: true, notes: [ note ] } );
		expect( getComputedStyle( host ).display ).toBe( 'block' );
		expect( root.querySelector( 'button' ) ).toBe( marker );
	} );

	it( 'briefly colors only the edited marker after rejecting another selection', () => {
		vi.useFakeTimers();
		document.body.innerHTML = '<h1>Welcome</h1><p>Other</p>';
		mount();
		const notes = [
			{ id: 'one', number: 1, pending: true, selector: 'h1', url: location.href },
			{ id: 'two', number: 2, selector: 'p', url: location.href },
		];
		publish( { active: true, notes, editingId: 'one', blockedNavigation: 0 } );
		publish( { active: true, notes, editingId: 'one', blockedNavigation: 1 } );
		const markers = document
			.getElementById( '__studio-inspector-host' )!
			.shadowRoot!.querySelectorAll( 'button' );
		expect( markers[ 0 ] ).toHaveAttribute( 'data-feedback', 'error' );
		expect( markers[ 1 ] ).not.toHaveAttribute( 'data-feedback' );
		vi.advanceTimersByTime( 900 );
		expect( markers[ 0 ] ).not.toHaveAttribute( 'data-feedback' );
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
