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

function pointer( element: Element, type: string, x: number, y: number, id = 1 ) {
	const event = new MouseEvent( type, {
		bubbles: true,
		cancelable: true,
		clientX: x,
		clientY: y,
		button: 0,
	} );
	Object.defineProperty( event, 'pointerId', { value: id } );
	element.dispatchEvent( event );
	return event;
}

function drawOval() {
	const points = Array.from( { length: 81 }, ( _, i ) => {
		const angle = ( i / 80 ) * Math.PI * 2;
		const wobble = 1 + Math.sin( angle * 5 ) * 0.04;
		return { x: 200 + Math.cos( angle ) * 80 * wobble, y: 200 + Math.sin( angle ) * 45 * wobble };
	} );
	pointer( document.body, 'pointerdown', points[ 0 ].x, points[ 0 ].y );
	for ( const point of points.slice( 1 ) )
		pointer( document.body, 'pointermove', point.x, point.y );
	return points.at( -1 )!;
}

describe( 'annotation inspector', () => {
	afterEach( () => {
		( window as Window & { __studioInspectorDispose?: () => void } ).__studioInspectorDispose?.();
		vi.useRealTimers();
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
		document.body.replaceChildren();
	} );

	it( 'hides the element highlight while a drawing note is open and restores hover afterward', () => {
		document.body.innerHTML = '<h1>Welcome</h1>';
		const heading = document.querySelector( 'h1' )!;
		vi.spyOn( heading, 'getBoundingClientRect' ).mockReturnValue( new DOMRect( 10, 20, 200, 40 ) );
		mount();
		vi.stubGlobal( 'requestAnimationFrame', ( callback: FrameRequestCallback ) => {
			callback( 0 );
			return 0;
		} );
		const note = {
			id: 'area-note',
			number: 1,
			kind: 'drawing',
			url: location.href,
			documentRect: { left: 100, top: 150, width: 300, height: 200 },
		};
		publish( { active: true, notes: [ note ], editingId: note.id } );
		pointer( heading, 'pointermove', 20, 30 );
		const highlight = document
			.getElementById( '__studio-inspector-host' )!
			.shadowRoot!.querySelector( '.highlight' );
		expect( highlight ).not.toBeVisible();
		publish( { active: true, notes: [ note ], editingId: null } );
		expect( highlight ).toHaveStyle( {
			left: '10px',
			top: '20px',
			width: '200px',
			height: '40px',
		} );
	} );

	it( 'keeps a quick oval freehand and hands it to the note immediately on release', () => {
		vi.useFakeTimers();
		const events = mount();
		publish( { active: true, tool: 'draw' } );
		const end = drawOval();
		vi.advanceTimersByTime( 200 );
		pointer( document.body, 'pointerup', end.x, end.y );
		const event = events().at( -1 );
		if ( event?.type !== 'selection' || ! event.selection ) throw new Error( 'Missing drawing' );
		expect( event.selection.drawing?.strokes[ 0 ] ).toHaveLength( 81 );
		expect( event.selection.drawing?.originalStroke ).toBeUndefined();
		vi.advanceTimersByTime( 1000 );
		expect( events() ).toHaveLength( 1 );
	} );

	it( 'recognizes a held oval before release and restores its original stroke when undoing the note', () => {
		vi.useFakeTimers();
		const events = mount();
		publish( { active: true, tool: 'draw' } );
		const end = drawOval();
		vi.advanceTimersByTime( 599 );
		expect( events() ).toEqual( [] );
		vi.advanceTimersByTime( 1 );
		const root = document.getElementById( '__studio-inspector-host' )!.shadowRoot!;
		expect( root.querySelector( 'path[stroke]' )?.getAttribute( 'd' ) ).toMatch( /Z$/ );
		expect( events() ).toEqual( [] );
		pointer( document.body, 'pointerup', end.x + 1, end.y + 1 );
		const event = events().at( -1 );
		if ( event?.type !== 'selection' || ! event.selection ) throw new Error( 'Missing shape' );
		const drawing = event.selection.drawing!;
		expect( drawing.strokes[ 0 ] ).toHaveLength( 65 );
		expect( drawing.originalStroke ).toHaveLength( 81 );
		publish( {
			active: true,
			tool: 'draw',
			editingId: 'shape-note',
			notes: [ { ...event.selection.target, drawing, id: 'shape-note', number: 1 } ],
		} );
		window.dispatchEvent(
			new CustomEvent( INSPECTOR_COMMAND_EVENT, {
				detail: { clearSelection: event.selection.id },
			} )
		);
		document.dispatchEvent(
			new KeyboardEvent( 'keydown', { key: 'z', metaKey: true, bubbles: true } )
		);
		expect( events().at( -1 ) ).toMatchObject( {
			type: 'selection',
			selection: { replaces: 'shape-note', drawing: { strokes: [ drawing.originalStroke ] } },
		} );
		const restored = events().at( -1 );
		if ( restored?.type === 'selection' )
			expect( restored.selection?.drawing?.originalStroke ).toBeUndefined();
		expect( root.querySelectorAll( '.saved-drawings path' ) ).toHaveLength( 0 );
	} );

	it( 'returns to freehand when drawing continues after the hold', () => {
		vi.useFakeTimers();
		const events = mount();
		publish( { active: true, tool: 'draw' } );
		const end = drawOval();
		vi.advanceTimersByTime( 600 );
		pointer( document.body, 'pointermove', end.x + 30, end.y + 30 );
		pointer( document.body, 'pointerup', end.x + 30, end.y + 30 );
		const event = events().at( -1 );
		if ( event?.type !== 'selection' || ! event.selection ) throw new Error( 'Missing drawing' );
		expect( event.selection.drawing?.strokes[ 0 ] ).toHaveLength( 82 );
		expect( event.selection.drawing?.originalStroke ).toBeUndefined();
	} );
	it( 'finishes a stroke when an earlier capture becomes busy after pointerdown', () => {
		const events = mount();
		publish( { active: true, tool: 'draw' } );
		pointer( document.body, 'pointerdown', 30, 40 );
		publish( { active: true, tool: 'draw', busy: true } );
		pointer( document.body, 'pointermove', 60, 70 );
		pointer( document.body, 'pointerup', 90, 100 );
		expect( events().at( -1 ) ).toMatchObject( {
			type: 'selection',
			selection: {
				drawing: {
					strokes: [
						[
							{ x: 30, y: 40 },
							{ x: 60, y: 70 },
							{ x: 90, y: 100 },
						],
					],
				},
			},
		} );
	} );

	it.each( [ 'cancel', 'blur', 'disable', 'dispose' ] )(
		'cancels the shape hold on %s',
		( reason ) => {
			vi.useFakeTimers();
			mount();
			publish( { active: true, tool: 'draw' } );
			drawOval();
			if ( reason === 'cancel' ) pointer( document.body, 'pointercancel', 0, 0 );
			if ( reason === 'blur' ) window.dispatchEvent( new Event( 'blur' ) );
			if ( reason === 'disable' ) publish( { active: false } );
			if ( reason === 'dispose' )
				(
					window as Window & { __studioInspectorDispose?: () => void }
				 ).__studioInspectorDispose?.();
			vi.advanceTimersByTime( 1000 );
			const root = document.getElementById( '__studio-inspector-host' )?.shadowRoot;
			expect( root?.querySelectorAll( 'path[stroke]' ).length ?? 0 ).toBe( 0 );
		}
	);

	it( 'uses the coalesced movement samples and renders a smooth live curve', () => {
		const events = mount();
		vi.stubGlobal( 'requestAnimationFrame', ( callback: FrameRequestCallback ) => {
			callback( 0 );
			return 0;
		} );
		publish( { active: true, tool: 'draw' } );
		pointer( document.body, 'pointerdown', 10, 10 );
		const event = new MouseEvent( 'pointermove', { bubbles: true, clientX: 70, clientY: 40 } );
		Object.defineProperties( event, {
			pointerId: { value: 1 },
			getCoalescedEvents: {
				value: () => [
					{ clientX: 25, clientY: 30 },
					{ clientX: 45, clientY: 20 },
				],
			},
		} );
		document.body.dispatchEvent( event );
		expect(
			document
				.getElementById( '__studio-inspector-host' )!
				.shadowRoot!.querySelector( 'path[stroke]' )
				?.getAttribute( 'd' )
		).toContain( 'Q' );
		pointer( document.body, 'pointerup', 70, 40 );
		expect( events().at( -1 ) ).toMatchObject( {
			selection: {
				drawing: {
					strokes: [
						[
							{ x: 10, y: 10 },
							{ x: 25, y: 30 },
							{ x: 45, y: 20 },
							{ x: 70, y: 40 },
						],
					],
				},
			},
		} );
	} );

	it( 'groups pen strokes, clamps their crop, and undoes one complete stroke', () => {
		const events = mount();
		publish( { active: true, tool: 'draw' } );
		pointer( document.body, 'pointerdown', 10, 10 );
		pointer( document.body, 'pointermove', 90, 80 );
		pointer( document.body, 'pointerup', 100, 80 );
		pointer( document.body, 'pointerdown', 110, 90 );
		pointer( document.body, 'pointerup', 120, 100 );
		const last = events().at( -1 );
		expect( last ).toMatchObject( {
			type: 'selection',
			selection: {
				target: { kind: 'drawing' },
				rect: { left: 0, top: 0, width: 144, height: 124 },
				drawing: { width: 3, strokes: [ expect.any( Array ), expect.any( Array ) ] },
			},
		} );
		document.dispatchEvent(
			new KeyboardEvent( 'keydown', { key: 'z', metaKey: true, bubbles: true } )
		);
		expect( events().at( -1 ) ).toMatchObject( {
			type: 'selection',
			selection: { drawing: { strokes: [ expect.any( Array ) ] } },
		} );
		document.dispatchEvent(
			new KeyboardEvent( 'keydown', { key: 'z', metaKey: true, bubbles: true } )
		);
		expect( events().at( -1 ) ).toEqual( { type: 'selection', selection: null } );
		expect( events().some( ( event ) => event?.type === 'pick' ) ).toBe( false );
	} );

	it( 'does not let the previous capture clear a newer pen stroke', () => {
		const events = mount();
		publish( { active: true, tool: 'draw' } );
		pointer( document.body, 'pointerdown', 10, 10 );
		pointer( document.body, 'pointerup', 50, 50 );
		const first = events().at( -1 );
		if ( first?.type !== 'selection' || ! first.selection )
			throw new Error( 'Missing first drawing' );
		pointer( document.body, 'pointerdown', 70, 70 );
		pointer( document.body, 'pointermove', 90, 90 );
		window.dispatchEvent(
			new CustomEvent( INSPECTOR_COMMAND_EVENT, {
				detail: { clearSelection: first.selection.id },
			} )
		);
		pointer( document.body, 'pointerup', 110, 100 );
		const latest = events().at( -1 );
		expect( latest ).toMatchObject( {
			type: 'selection',
			selection: { drawing: { strokes: [ expect.any( Array ), expect.any( Array ) ] } },
		} );
		if ( latest?.type !== 'selection' || ! latest.selection )
			throw new Error( 'Missing latest drawing' );
		window.dispatchEvent(
			new CustomEvent( INSPECTOR_COMMAND_EVENT, {
				detail: { clearSelection: first.selection.id },
			} )
		);
		expect( document.getElementById( '__studio-inspector-host' ) ).toHaveAttribute(
			'data-capture-id',
			latest.selection.id
		);
	} );

	it( 'finishes the first stroke when preview focus releases pointer capture before pointerup', () => {
		const events = mount();
		publish( { active: true, tool: 'draw' } );
		pointer( document.body, 'pointerdown', 30, 40 );
		pointer( document.body, 'pointermove', 60, 70 );
		pointer( document.documentElement, 'lostpointercapture', 60, 70 );
		pointer( document.body, 'pointerup', 90, 100 );
		expect( events().at( -1 ) ).toMatchObject( {
			type: 'selection',
			selection: {
				drawing: {
					strokes: [
						[
							{ x: 30, y: 40 },
							{ x: 60, y: 70 },
							{ x: 90, y: 100 },
						],
					],
				},
			},
		} );
	} );

	it( 'holds scrolling for a drawing and clears the draft before exiting on Escape', () => {
		const events = mount();
		publish( { active: true, tool: 'draw' } );
		pointer( document.body, 'pointerdown', 30, 40 );
		pointer( document.body, 'pointerup', 80, 100 );
		const wheel = new WheelEvent( 'wheel', { bubbles: true, cancelable: true, deltaY: 100 } );
		document.dispatchEvent( wheel );
		expect( wheel.defaultPrevented ).toBe( true );
		document.dispatchEvent( new KeyboardEvent( 'keydown', { key: 'Escape', bubbles: true } ) );
		expect( events().at( -1 ) ).toEqual( { type: 'selection', selection: null } );
		document.dispatchEvent( new KeyboardEvent( 'keydown', { key: 'Escape', bubbles: true } ) );
		expect( events().at( -1 ) ).toEqual( { type: 'escape' } );
	} );

	it( 'ignores another pointer cancelling and drops only the unfinished stroke on blur', () => {
		const events = mount();
		publish( { active: true, tool: 'draw' } );
		pointer( document.body, 'pointerdown', 30, 40 );
		pointer( document.body, 'pointerup', 80, 100 );
		pointer( document.body, 'pointerdown', 100, 120 );
		pointer( document.body, 'pointercancel', 100, 120, 2 );
		window.dispatchEvent( new Event( 'blur' ) );
		expect( events().at( -1 ) ).toMatchObject( {
			type: 'selection',
			selection: {
				drawing: {
					strokes: [
						[
							{ x: 30, y: 40 },
							{ x: 80, y: 100 },
						],
					],
				},
			},
		} );
	} );

	it( 'keeps the completed drawing visible with its normal marker after handing it to the note editor', () => {
		const events = mount();
		publish( { active: true, tool: 'draw' } );
		pointer( document.body, 'pointerdown', 30, 40 );
		pointer( document.body, 'pointerup', 80, 100 );
		const event = events().find( ( item ) => item?.type === 'selection' && item.selection );
		if ( event?.type !== 'selection' || ! event.selection )
			throw new Error( 'Missing completed drawing' );
		publish( {
			active: true,
			tool: 'draw',
			editingId: 'drawing-note',
			notes: [
				{
					...event.selection.target,
					drawing: event.selection.drawing,
					id: 'drawing-note',
					number: 1,
					pending: true,
				},
			],
		} );
		window.dispatchEvent(
			new CustomEvent( INSPECTOR_COMMAND_EVENT, { detail: { clearSelection: event.selection.id } } )
		);
		const root = document.getElementById( '__studio-inspector-host' )!.shadowRoot!;
		expect( root.querySelector( 'button' ) ).toBeVisible();
		expect( root.querySelector( 'button' ) ).toHaveAttribute( 'aria-label', 'Pending annotation' );
		expect( root.querySelector( '.saved-drawings path' ) ).toHaveAttribute( 'd', 'M30 40L80 100' );
		expect( root.querySelector( '.highlight' ) ).not.toBeVisible();
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
		'selects a rectangle from (%s, %s) to (%s, %s) without picking an element',
		( x, y, endX, endY ) => {
			document.body.innerHTML = '<h1>Welcome</h1><p>Other content</p>';
			const events = mount();
			publish( { active: true, areaSelection: true } );
			pointer( document.body, 'pointerdown', x, y );
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
		expect(
			events().filter( ( event ) => event?.type === 'selection' && event.selection )
		).toHaveLength( 2 );
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

	it.each( [
		[ 'v', 'KeyV', 'select' ],
		[ 'd', 'KeyD', 'draw' ],
		[ 'D', 'KeyD', 'draw' ],
		[ 'в', 'KeyD', 'draw' ],
	] )( 'forwards the %s tool shortcut from the preview', ( key, code, tool ) => {
		const events = mount();
		publish( { active: true, tool: 'select' } );
		const event = new KeyboardEvent( 'keydown', { key, code, bubbles: true, cancelable: true } );
		document.dispatchEvent( event );
		expect( event.defaultPrevented ).toBe( true );
		expect( events() ).toEqual( [ { type: 'annotation-tool', tool } ] );
	} );

	it.each( [
		{ ctrlKey: true },
		{ metaKey: true },
		{ altKey: true },
		{ shiftKey: true },
		{ repeat: true },
		{ isComposing: true },
		{ keyCode: 229 },
	] )( 'leaves modified, repeated, and composing tool keys alone (%j)', ( modifiers ) => {
		const events = mount();
		publish( { active: true, tool: 'select' } );
		const event = new KeyboardEvent( 'keydown', {
			key: 'd',
			code: 'KeyD',
			bubbles: true,
			cancelable: true,
			...modifiers,
		} );
		document.dispatchEvent( event );
		expect( event.defaultPrevented ).toBe( false );
		expect( events() ).toEqual( [] );
	} );

	it.each( [
		'<input>',
		'<textarea></textarea>',
		'<select></select>',
		'<div contenteditable="true"><span>Editing</span></div>',
		'<div role="menu"><button>Duplicate</button></div>',
		'<div role="dialog"><button>Done</button></div>',
	] )( 'leaves tool letters to editing and popup controls: %s', ( html ) => {
		document.body.innerHTML = html;
		const events = mount();
		publish( { active: true, tool: 'select' } );
		const event = new KeyboardEvent( 'keydown', {
			key: 'd',
			bubbles: true,
			cancelable: true,
		} );
		const target = document.querySelector( 'span, button, input, textarea, select' )!;
		target.dispatchEvent( event );
		expect( event.defaultPrevented ).toBe( false );
		expect( events() ).toEqual( [] );
	} );

	it.each( [
		{ active: false, tool: 'select' },
		{ active: true, tool: 'select', busy: true },
		{ active: true },
	] )( 'only handles tool keys for an available drawing toolbar (%j)', ( state ) => {
		const events = mount();
		publish( state );
		const event = new KeyboardEvent( 'keydown', {
			key: 'd',
			bubbles: true,
			cancelable: true,
		} );
		document.dispatchEvent( event );
		expect( event.defaultPrevented ).toBe( false );
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
		message( { type: 'annotation-tool', tool: 'erase' } ),
		INSPECTOR_BRIDGE_PREFIX + '{',
		message( { type: 'escape', padding: 'x'.repeat( 100_000 ) } ),
	] )( 'ignores %s', ( value ) => {
		expect( parseInspectorMessage( value ) ).toBeNull();
	} );
} );
