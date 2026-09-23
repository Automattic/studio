import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	INSPECTOR_BRIDGE_PREFIX,
	INSPECTOR_COMMAND_EVENT,
	INSPECTOR_PAGE_SCRIPT,
} from './inspector-script';

describe( 'site preview inspector sessions', () => {
	afterEach( () => {
		// Without this the previous inspector's document listeners stay live and
		// answer the next test's commands alongside the instance under test.
		( window as Window & { __studioInspectorDispose?: () => void } ).__studioInspectorDispose?.();
		vi.restoreAllMocks();
		vi.useRealTimers();
		vi.unstubAllGlobals();
		document.body.replaceChildren();
		delete ( window as Window & { __studioInspectorState?: unknown[] } ).__studioInspectorState;
	} );

	it( 'explains the annotation actions with button tooltips', () => {
		vi.useFakeTimers();
		document.body.innerHTML = '<h1 id="target">Target</h1>';
		const target = document.querySelector( '#target' ) as HTMLElement;
		vi.spyOn( target, 'getBoundingClientRect' ).mockReturnValue( rect( 10, 10 ) );

		new Function( INSPECTOR_PAGE_SCRIPT )();
		const root = ( document.querySelector( '#__studio-inspector-host' ) as HTMLElement )
			.shadowRoot as ShadowRoot;
		command( 'toggle-picking' );
		target.dispatchEvent( new MouseEvent( 'click', { bubbles: true, cancelable: true } ) );

		expect( root.querySelector( '.save' ) ).toHaveAttribute(
			'data-tooltip',
			'Save this note and keep annotating.'
		);
		expect( root.querySelector( '.save' ) ).toHaveTextContent( 'Save' );
		expect( root.querySelector( '.submit' ) ).toHaveTextContent( 'Send to chat' );
		expect( root.querySelector( '.submit' ) ).toHaveAttribute(
			'data-tooltip',
			'Send all notes to chat and finish annotating.'
		);
		const textarea = root.querySelector( 'textarea' ) as HTMLTextAreaElement;
		textarea.value = 'Change this heading';
		textarea.dispatchEvent( new InputEvent( 'input', { bubbles: true } ) );
		const add = root.querySelector( '.save' ) as HTMLButtonElement;
		const submit = root.querySelector( '.submit' ) as HTMLButtonElement;
		add.dispatchEvent( new MouseEvent( 'mouseenter' ) );
		vi.advanceTimersByTime( 599 );
		expect( add ).not.toHaveClass( 'tooltip-open' );
		vi.advanceTimersByTime( 1 );
		expect( add ).toHaveClass( 'tooltip-open' );
		add.dispatchEvent( new MouseEvent( 'mouseleave' ) );
		expect( add ).not.toHaveClass( 'tooltip-open' );
		submit.dispatchEvent( new MouseEvent( 'mouseenter' ) );
		expect( submit ).toHaveClass( 'tooltip-open' );
	} );

	it( 'saves several notes without leaving annotation mode', () => {
		const log = vi.spyOn( console, 'log' ).mockImplementation( () => undefined );
		document.body.innerHTML = '<h1 id="first">First</h1><p id="second">Second</p>';
		const first = document.querySelector( '#first' ) as HTMLElement;
		const second = document.querySelector( '#second' ) as HTMLElement;
		vi.spyOn( first, 'getBoundingClientRect' ).mockReturnValue( rect( 10, 10 ) );
		vi.spyOn( second, 'getBoundingClientRect' ).mockReturnValue( rect( 10, 80 ) );

		new Function( INSPECTOR_PAGE_SCRIPT )();
		const root = ( document.querySelector( '#__studio-inspector-host' ) as HTMLElement )
			.shadowRoot as ShadowRoot;
		command( 'toggle-picking' );
		first.dispatchEvent( new MouseEvent( 'click', { bubbles: true, cancelable: true } ) );

		const firstTextarea = root.querySelector( 'textarea' ) as HTMLTextAreaElement;
		firstTextarea.value = 'First note';
		firstTextarea.dispatchEvent( new InputEvent( 'input', { bubbles: true } ) );
		firstTextarea.dispatchEvent(
			new KeyboardEvent( 'keydown', { key: 'Enter', bubbles: true, cancelable: true } )
		);

		expect( root.querySelector( '.popup' ) ).toBeNull();
		expect( root.querySelectorAll( '.marker' ) ).toHaveLength( 1 );
		expect( latestState( log ) ).toMatchObject( { isPicking: true, annotationCount: 1 } );

		second.dispatchEvent( new MouseEvent( 'click', { bubbles: true, cancelable: true } ) );
		const secondTextarea = root.querySelector( 'textarea' ) as HTMLTextAreaElement;
		secondTextarea.value = 'First line';
		secondTextarea.dispatchEvent( new InputEvent( 'input', { bubbles: true } ) );
		secondTextarea.setSelectionRange( secondTextarea.value.length, secondTextarea.value.length );
		secondTextarea.dispatchEvent(
			new KeyboardEvent( 'keydown', {
				key: 'Enter',
				metaKey: true,
				bubbles: true,
				cancelable: true,
			} )
		);
		expect( secondTextarea.value ).toBe( 'First line\n' );
		secondTextarea.value += 'Second line';
		secondTextarea.dispatchEvent( new InputEvent( 'input', { bubbles: true } ) );
		command( 'submit' );

		const done = bridgeMessages( log ).find( ( message ) => message.type === 'done' );
		expect( done?.annotations ).toEqual(
			expect.arrayContaining( [
				expect.objectContaining( { comment: 'First note' } ),
				expect.objectContaining( { comment: 'First line\nSecond line' } ),
			] )
		);
		expect( latestState( log ) ).toMatchObject( { isPicking: false, annotationCount: 0 } );
	} );

	it( 'requests cancellation when Escape is pressed while annotating', () => {
		const log = vi.spyOn( console, 'log' ).mockImplementation( () => undefined );
		seedSavedNote();

		new Function( INSPECTOR_PAGE_SCRIPT )();
		command( 'toggle-picking' );
		document.dispatchEvent(
			new KeyboardEvent( 'keydown', { key: 'Escape', bubbles: true, cancelable: true } )
		);

		expect( bridgeMessages( log ) ).toContainEqual( { type: 'cancel-requested' } );
		expect( latestState( log ) ).toMatchObject( { isPicking: true, annotationCount: 1 } );
		expect(
			( window as Window & { __studioInspectorState?: unknown[] } ).__studioInspectorState
		).toHaveLength( 1 );
	} );

	it( 'discards saved notes and unfinished drafts when cancelled', () => {
		const log = vi.spyOn( console, 'log' ).mockImplementation( () => undefined );
		document.body.innerHTML = '<h1 id="draft">Draft</h1>';
		const draft = document.querySelector( '#draft' ) as HTMLElement;
		vi.spyOn( draft, 'getBoundingClientRect' ).mockReturnValue( rect( 10, 10 ) );
		seedSavedNote();

		new Function( INSPECTOR_PAGE_SCRIPT )();
		const root = ( document.querySelector( '#__studio-inspector-host' ) as HTMLElement )
			.shadowRoot as ShadowRoot;
		command( 'toggle-picking' );
		draft.dispatchEvent( new MouseEvent( 'click', { bubbles: true, cancelable: true } ) );
		const textarea = root.querySelector( 'textarea' ) as HTMLTextAreaElement;
		textarea.value = 'Unfinished note';
		textarea.dispatchEvent( new InputEvent( 'input', { bubbles: true } ) );
		expect( latestState( log ) ).toMatchObject( { hasUnsavedDraft: true } );

		command( 'cancel' );

		expect( latestState( log ) ).toMatchObject( {
			isPicking: false,
			annotationCount: 0,
			hasUnsavedDraft: false,
		} );
		expect( root.querySelector( '.popup' ) ).toBeNull();
		expect( root.querySelectorAll( '.marker' ) ).toHaveLength( 0 );
		expect(
			( window as Window & { __studioInspectorState?: unknown[] } ).__studioInspectorState
		).toEqual( [] );
		expect( bridgeMessages( log ).find( ( message ) => message.type === 'done' ) ).toBeUndefined();
	} );

	it( 'moves saved pins with their elements when the page reflows', () => {
		vi.spyOn( console, 'log' ).mockImplementation( () => undefined );
		vi.spyOn( window, 'requestAnimationFrame' ).mockImplementation( ( cb ) => {
			cb( 0 );
			return 1;
		} );
		document.body.innerHTML = '<h1 id="first">First</h1>';
		const first = document.querySelector( '#first' ) as HTMLElement;
		const measure = vi.spyOn( first, 'getBoundingClientRect' ).mockReturnValue( rect( 10, 10 ) );

		new Function( INSPECTOR_PAGE_SCRIPT )();
		const root = ( document.querySelector( '#__studio-inspector-host' ) as HTMLElement )
			.shadowRoot as ShadowRoot;
		command( 'toggle-picking' );
		first.dispatchEvent( new MouseEvent( 'click', { bubbles: true, cancelable: true } ) );
		const textarea = root.querySelector( 'textarea' ) as HTMLTextAreaElement;
		textarea.value = 'Note';
		textarea.dispatchEvent( new InputEvent( 'input', { bubbles: true } ) );
		textarea.dispatchEvent(
			new KeyboardEvent( 'keydown', { key: 'Enter', bubbles: true, cancelable: true } )
		);

		const marker = root.querySelector( '.marker' ) as HTMLElement;
		expect( marker.style.getPropertyValue( 'top' ) ).toBe( '10px' );

		// A narrower viewport pushes the heading down; the pin must follow.
		measure.mockReturnValue( rect( 10, 300 ) );
		window.dispatchEvent( new Event( 'resize' ) );

		expect( marker.style.getPropertyValue( 'top' ) ).toBe( '300px' );
	} );

	it( 'reopens an existing note without turning picking back on', () => {
		const log = vi.spyOn( console, 'log' ).mockImplementation( () => undefined );
		seedSavedNote();

		new Function( INSPECTOR_PAGE_SCRIPT )();
		const root = ( document.querySelector( '#__studio-inspector-host' ) as HTMLElement )
			.shadowRoot as ShadowRoot;
		const marker = root.querySelector( '.marker' ) as HTMLElement;
		marker.dispatchEvent( new MouseEvent( 'click', { bubbles: true, cancelable: true } ) );

		expect( root.querySelector( '.popup' ) ).toBeInTheDocument();
		expect( latestState( log ) ).toMatchObject( { isPicking: false, annotationCount: 1 } );
	} );

	it( 'submits saved notes when an empty draft popup is open', () => {
		const log = vi.spyOn( console, 'log' ).mockImplementation( () => undefined );
		document.body.innerHTML = '<h1 id="draft">Draft</h1>';
		const draft = document.querySelector( '#draft' ) as HTMLElement;
		vi.spyOn( draft, 'getBoundingClientRect' ).mockReturnValue( rect( 10, 10 ) );
		seedSavedNote();

		new Function( INSPECTOR_PAGE_SCRIPT )();
		command( 'toggle-picking' );
		draft.dispatchEvent( new MouseEvent( 'click', { bubbles: true, cancelable: true } ) );
		command( 'submit' );

		const done = bridgeMessages( log ).find( ( message ) => message.type === 'done' );
		expect( done?.annotations ).toEqual( [ expect.objectContaining( { comment: 'Saved note' } ) ] );
		expect( latestState( log ) ).toMatchObject( { isPicking: false, annotationCount: 0 } );
	} );

	it( 'does not save while text input is being composed', () => {
		vi.spyOn( console, 'log' ).mockImplementation( () => undefined );
		document.body.innerHTML = '<h1 id="composing">Composing</h1>';
		const target = document.querySelector( '#composing' ) as HTMLElement;
		vi.spyOn( target, 'getBoundingClientRect' ).mockReturnValue( rect( 10, 10 ) );

		new Function( INSPECTOR_PAGE_SCRIPT )();
		const root = ( document.querySelector( '#__studio-inspector-host' ) as HTMLElement )
			.shadowRoot as ShadowRoot;
		command( 'toggle-picking' );
		target.dispatchEvent( new MouseEvent( 'click', { bubbles: true, cancelable: true } ) );

		const textarea = root.querySelector( 'textarea' ) as HTMLTextAreaElement;
		textarea.value = '入力中';
		textarea.dispatchEvent( new InputEvent( 'input', { bubbles: true } ) );
		textarea.dispatchEvent(
			new KeyboardEvent( 'keydown', {
				key: 'Enter',
				isComposing: true,
				bubbles: true,
				cancelable: true,
			} )
		);

		expect( root.querySelector( '.popup' ) ).toBeInTheDocument();
		expect( root.querySelectorAll( '.marker' ) ).toHaveLength( 0 );
	} );

	it( 'locks page scrolling while a note is open and restores it after', () => {
		vi.spyOn( console, 'log' ).mockImplementation( () => undefined );
		document.body.innerHTML = '<h1 id="first">First</h1>';
		document.body.style.overflow = 'auto';
		const first = document.querySelector( '#first' ) as HTMLElement;
		vi.spyOn( first, 'getBoundingClientRect' ).mockReturnValue( rect( 10, 10 ) );

		new Function( INSPECTOR_PAGE_SCRIPT )();
		command( 'toggle-picking' );
		first.dispatchEvent( new MouseEvent( 'click', { bubbles: true, cancelable: true } ) );
		expect( document.body.style.getPropertyValue( 'overflow' ) ).toBe( 'hidden' );
		expect( document.documentElement.style.getPropertyValue( 'overflow' ) ).toBe( 'hidden' );

		document.dispatchEvent(
			new KeyboardEvent( 'keydown', { key: 'Escape', bubbles: true, cancelable: true } )
		);
		expect( document.body.style.getPropertyValue( 'overflow' ) ).toBe( 'auto' );
		expect( document.documentElement.style.getPropertyValue( 'overflow' ) ).toBe( '' );
	} );

	it( 'lets the note be dragged by its element row', () => {
		vi.spyOn( console, 'log' ).mockImplementation( () => undefined );
		document.body.innerHTML = '<h1 id="first">First</h1>';
		const first = document.querySelector( '#first' ) as HTMLElement;
		vi.spyOn( first, 'getBoundingClientRect' ).mockReturnValue( rect( 200, 100 ) );
		vi.stubGlobal( 'requestAnimationFrame', ( cb: FrameRequestCallback ) => {
			cb( 0 );
			return 1;
		} );

		new Function( INSPECTOR_PAGE_SCRIPT )();
		const root = ( document.querySelector( '#__studio-inspector-host' ) as HTMLElement )
			.shadowRoot as ShadowRoot;
		command( 'toggle-picking' );
		first.dispatchEvent( new MouseEvent( 'click', { bubbles: true, cancelable: true } ) );

		const popup = root.querySelector( '.popup' ) as HTMLElement;
		const handle = root.querySelector( '.target' ) as HTMLElement;
		trackPopupRect( popup );
		const startLeft = parseFloat( popup.style.left );
		const startTop = parseFloat( popup.style.top );

		handle.dispatchEvent(
			new MouseEvent( 'mousedown', { bubbles: true, button: 0, clientX: 300, clientY: 200 } )
		);
		window.dispatchEvent( new MouseEvent( 'mousemove', { clientX: 340, clientY: 230 } ) );
		expect( popup.style.getPropertyValue( 'transform' ) ).toBe( 'translate(40px, 30px)' );
		window.dispatchEvent( new MouseEvent( 'mouseup', { clientX: 340, clientY: 230 } ) );

		expect( popup.style.getPropertyValue( 'transform' ) ).toBe( '' );
		expect( parseFloat( popup.style.left ) ).toBe( startLeft + 40 );
		expect( parseFloat( popup.style.top ) ).toBe( startTop + 30 );
		// A re-render (e.g. typing) keeps the dragged position.
		const ta = root.querySelector( 'textarea' ) as HTMLTextAreaElement;
		ta.value = 'note';
		ta.dispatchEvent( new InputEvent( 'input', { bubbles: true } ) );
		window.dispatchEvent( new Event( 'resize' ) );
		expect( parseFloat( ( root.querySelector( '.popup' ) as HTMLElement ).style.left ) ).toBe(
			startLeft + 40
		);
	} );

	it( 'keeps an undragged note anchored to its element when the page reflows', () => {
		vi.spyOn( console, 'log' ).mockImplementation( () => undefined );
		document.body.innerHTML = '<h1 id="first">First</h1>';
		const first = document.querySelector( '#first' ) as HTMLElement;
		const measure = vi.spyOn( first, 'getBoundingClientRect' ).mockReturnValue( rect( 400, 100 ) );
		vi.stubGlobal( 'requestAnimationFrame', ( cb: FrameRequestCallback ) => {
			cb( 0 );
			return 1;
		} );

		new Function( INSPECTOR_PAGE_SCRIPT )();
		const root = ( document.querySelector( '#__studio-inspector-host' ) as HTMLElement )
			.shadowRoot as ShadowRoot;
		command( 'toggle-picking' );
		first.dispatchEvent( new MouseEvent( 'click', { bubbles: true, cancelable: true } ) );
		expect( parseFloat( ( root.querySelector( '.popup' ) as HTMLElement ).style.left ) ).toBe(
			290
		);

		// A narrower layout moves the element; the note has to follow it.
		measure.mockReturnValue( rect( 20, 100 ) );
		window.dispatchEvent( new Event( 'resize' ) );
		expect( parseFloat( ( root.querySelector( '.popup' ) as HTMLElement ).style.left ) ).toBe( 8 );
	} );

	it( 'pulls a dragged note back inside the viewport when it shrinks', () => {
		vi.spyOn( console, 'log' ).mockImplementation( () => undefined );
		document.body.innerHTML = '<h1 id="first">First</h1>';
		const first = document.querySelector( '#first' ) as HTMLElement;
		vi.spyOn( first, 'getBoundingClientRect' ).mockReturnValue( rect( 200, 100 ) );
		// Handle 0 keeps relayout's in-flight guard clear once this synchronous
		// stub has run, so the test can reflow more than once.
		vi.stubGlobal( 'requestAnimationFrame', ( cb: FrameRequestCallback ) => {
			cb( 0 );
			return 0;
		} );

		new Function( INSPECTOR_PAGE_SCRIPT )();
		const root = ( document.querySelector( '#__studio-inspector-host' ) as HTMLElement )
			.shadowRoot as ShadowRoot;
		command( 'toggle-picking' );
		first.dispatchEvent( new MouseEvent( 'click', { bubbles: true, cancelable: true } ) );

		const handle = root.querySelector( '.target' ) as HTMLElement;
		trackPopupRect( root.querySelector( '.popup' ) as HTMLElement );
		handle.dispatchEvent(
			new MouseEvent( 'mousedown', { bubbles: true, button: 0, clientX: 300, clientY: 200 } )
		);
		window.dispatchEvent( new MouseEvent( 'mousemove', { clientX: 900, clientY: 200 } ) );
		window.dispatchEvent( new MouseEvent( 'mouseup', { clientX: 900, clientY: 200 } ) );
		expect( parseFloat( ( root.querySelector( '.popup' ) as HTMLElement ).style.left ) ).toBe(
			690
		);

		// Shrinking the pane must not strand the note outside it.
		vi.stubGlobal( 'innerWidth', 400 );
		window.dispatchEvent( new Event( 'resize' ) );
		expect( parseFloat( ( root.querySelector( '.popup' ) as HTMLElement ).style.left ) ).toBe( 72 );

		// Clamping is for display only, so widening gives the note back.
		vi.stubGlobal( 'innerWidth', 1024 );
		window.dispatchEvent( new Event( 'resize' ) );
		expect( parseFloat( ( root.querySelector( '.popup' ) as HTMLElement ).style.left ) ).toBe(
			690
		);
	} );

	it( 'dims the page around the selected element while a note is open', () => {
		vi.spyOn( console, 'log' ).mockImplementation( () => undefined );
		document.body.innerHTML = '<h1 id="first">First</h1>';
		const first = document.querySelector( '#first' ) as HTMLElement;
		vi.spyOn( first, 'getBoundingClientRect' ).mockReturnValue( rect( 10, 20 ) );

		new Function( INSPECTOR_PAGE_SCRIPT )();
		const root = ( document.querySelector( '#__studio-inspector-host' ) as HTMLElement )
			.shadowRoot as ShadowRoot;
		command( 'toggle-picking' );
		expect( root.querySelectorAll( '.scrim' ) ).toHaveLength( 0 );

		first.dispatchEvent( new MouseEvent( 'click', { bubbles: true, cancelable: true } ) );
		const panels = Array.from( root.querySelectorAll( '.scrim' ) ) as HTMLElement[];
		expect( panels ).toHaveLength( 4 );
		// Top band ends where the element starts; the left band stops at its edge.
		expect( panels[ 0 ] ).toHaveStyle( { height: '20px' } );
		expect( panels[ 1 ] ).toHaveStyle( { top: '60px' } );
		expect( panels[ 2 ] ).toHaveStyle( { width: '10px' } );
		expect( panels[ 3 ] ).toHaveStyle( { left: '110px' } );

		document.dispatchEvent(
			new KeyboardEvent( 'keydown', { key: 'Escape', bubbles: true, cancelable: true } )
		);
		expect( root.querySelector( '.popup' ) ).toBeNull();
		expect( root.querySelectorAll( '.scrim' ) ).toHaveLength( 0 );
	} );

	it( 'skips the dimming when a saved note has no usable element rect', () => {
		vi.spyOn( console, 'log' ).mockImplementation( () => undefined );
		// The annotated element is gone, so the empty rect saved with the note is
		// all that is left — a zero-size hole would black out the whole page.
		( window as Window & { __studioInspectorState?: unknown[] } ).__studioInspectorState = [
			{
				id: 'saved',
				comment: 'Saved note',
				tag: 'h1',
				selector: '#vanished',
				path: window.location.pathname + window.location.search,
				documentRect: { left: 0, top: 0, width: 0, height: 0 },
			},
		];
		document.body.innerHTML = '<p>Unrelated</p>';

		new Function( INSPECTOR_PAGE_SCRIPT )();
		const root = ( document.querySelector( '#__studio-inspector-host' ) as HTMLElement )
			.shadowRoot as ShadowRoot;
		const marker = root.querySelector( '.marker' ) as HTMLElement;
		marker.dispatchEvent( new MouseEvent( 'click', { bubbles: true, cancelable: true } ) );

		expect( root.querySelector( '.popup' ) ).toBeInTheDocument();
		expect( root.querySelectorAll( '.scrim' ) ).toHaveLength( 0 );
	} );

	it( 'offers the elements stacked under the click as layers', () => {
		vi.spyOn( console, 'log' ).mockImplementation( () => undefined );
		document.body.innerHTML = '<section id="wrap"><h1 id="title">Title</h1></section>';
		const wrap = document.querySelector( '#wrap' ) as HTMLElement;
		const title = document.querySelector( '#title' ) as HTMLElement;
		vi.spyOn( wrap, 'getBoundingClientRect' ).mockReturnValue( rect( 0, 0, 400, 300 ) );
		vi.spyOn( title, 'getBoundingClientRect' ).mockReturnValue( rect( 10, 10 ) );

		new Function( INSPECTOR_PAGE_SCRIPT )();
		const root = ( document.querySelector( '#__studio-inspector-host' ) as HTMLElement )
			.shadowRoot as ShadowRoot;
		command( 'toggle-picking' );
		title.dispatchEvent(
			new MouseEvent( 'click', { bubbles: true, cancelable: true, clientX: 20, clientY: 20 } )
		);

		expect( root.querySelector( '.layers .count' )?.textContent ).toBe( '1/2' );
		expect( root.querySelector( '.target code' )?.textContent ).toBe( '<h1>' );
		expect(
			( root.querySelector( '.highlight' ) as HTMLElement ).style.getPropertyValue( 'width' )
		).toBe( '100px' );

		stepBack( root );
		expect( root.querySelector( '.layers .count' )?.textContent ).toBe( '2/2' );
		expect( root.querySelector( '.target code' )?.textContent ).toBe( '<section>' );
		expect(
			( root.querySelector( '.highlight' ) as HTMLElement ).style.getPropertyValue( 'width' )
		).toBe( '400px' );
		// The scrim hole follows the chosen layer too.
		expect(
			( root.querySelectorAll( '.scrim' )[ 0 ] as HTMLElement ).style.getPropertyValue( 'height' )
		).toBe( '0px' );
	} );

	it( 'stops the layer picker at both ends of the stack instead of wrapping', () => {
		const root = stackedLayers();
		const buttons = () =>
			Array.from( root.querySelectorAll( '.layers button' ) ) as HTMLButtonElement[];

		// Frontmost layer: only the right arrow, which counts up, is live.
		expect( buttons().map( ( b ) => [ b.textContent, b.disabled ] ) ).toEqual( [
			[ '‹', true ],
			[ '›', false ],
		] );

		buttons()[ 1 ].click();
		expect( root.querySelector( '.layers .count' )?.textContent ).toBe( '2/2' );
		// Backmost layer: nothing is behind it, and the spent control is inert.
		expect( buttons().map( ( b ) => [ b.textContent, b.disabled ] ) ).toEqual( [
			[ '‹', false ],
			[ '›', true ],
		] );
		buttons()[ 1 ].click();
		expect( root.querySelector( '.layers .count' )?.textContent ).toBe( '2/2' );

		buttons()[ 0 ].click();
		expect( root.querySelector( '.layers .count' )?.textContent ).toBe( '1/2' );
	} );

	it( 'describes a stacked layer only once it is shown', () => {
		// Both elements are measured once by the hit-test filter; the extra
		// measurement is the target description, which only the shown layer gets.
		const computed = vi.spyOn( window, 'getComputedStyle' );
		const root = stackedLayers();
		const measurements = ( el: Element ) =>
			computed.mock.calls.filter( ( call ) => call[ 0 ] === el ).length;
		const wrap = document.querySelector( '#wrap' ) as HTMLElement;
		const title = document.querySelector( '#title' ) as HTMLElement;

		expect( measurements( title ) ).toBe( measurements( wrap ) + 1 );

		stepBack( root );
		expect( measurements( title ) ).toBe( measurements( wrap ) );
	} );
} );

/* Clicks ›, which walks one layer deeper into the stack. */
function stepBack( root: ShadowRoot ) {
	( root.querySelectorAll( '.layers button' )[ 1 ] as HTMLButtonElement ).click();
}

/* Mounts the inspector over an `<h1>` inside a larger `<section>` and clicks
 * the heading, leaving a two-layer picker open. Returns the shadow root. */
function stackedLayers(): ShadowRoot {
	vi.spyOn( console, 'log' ).mockImplementation( () => undefined );
	document.body.innerHTML = '<section id="wrap"><h1 id="title">Title</h1></section>';
	const wrap = document.querySelector( '#wrap' ) as HTMLElement;
	const title = document.querySelector( '#title' ) as HTMLElement;
	vi.spyOn( wrap, 'getBoundingClientRect' ).mockReturnValue( rect( 0, 0, 400, 300 ) );
	vi.spyOn( title, 'getBoundingClientRect' ).mockReturnValue( rect( 10, 10 ) );

	new Function( INSPECTOR_PAGE_SCRIPT )();
	const root = ( document.querySelector( '#__studio-inspector-host' ) as HTMLElement )
		.shadowRoot as ShadowRoot;
	command( 'toggle-picking' );
	title.dispatchEvent(
		new MouseEvent( 'click', { bubbles: true, cancelable: true, clientX: 20, clientY: 20 } )
	);
	return root;
}

function seedSavedNote() {
	( window as Window & { __studioInspectorState?: unknown[] } ).__studioInspectorState = [
		{
			id: 'saved',
			comment: 'Saved note',
			tag: 'h1',
			path: window.location.pathname + window.location.search,
			documentRect: { left: 10, top: 10, width: 100, height: 40 },
		},
	];
}

function trackPopupRect( popup: HTMLElement ) {
	// jsdom never lays out, so getBoundingClientRect always reads 0. Report the
	// rect a browser would for the styles positionPopup just wrote.
	vi.spyOn( popup, 'getBoundingClientRect' ).mockImplementation( () =>
		rect( parseFloat( popup.style.left ), parseFloat( popup.style.top ) )
	);
}

function command( type: string ) {
	window.dispatchEvent( new CustomEvent( INSPECTOR_COMMAND_EVENT, { detail: { type } } ) );
}

function rect( left: number, top: number, width = 100, height = 40 ): DOMRect {
	return {
		x: left,
		y: top,
		left,
		top,
		right: left + width,
		bottom: top + height,
		width,
		height,
		toJSON: () => ( {} ),
	} as DOMRect;
}

interface ConsoleLogSpy {
	mock: { calls: unknown[][] };
}

function bridgeMessages( log: ConsoleLogSpy ): Array< Record< string, unknown > > {
	return log.mock.calls
		.map( ( call ) => call[ 0 ] )
		.filter(
			( message ): message is string =>
				typeof message === 'string' && message.startsWith( INSPECTOR_BRIDGE_PREFIX )
		)
		.map( ( message ) => JSON.parse( message.slice( INSPECTOR_BRIDGE_PREFIX.length ) ) );
}

function latestState( log: ConsoleLogSpy ) {
	return bridgeMessages( log )
		.filter( ( message ) => message.type === 'state' )
		.at( -1 );
}
