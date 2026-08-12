import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	INSPECTOR_BRIDGE_PREFIX,
	INSPECTOR_COMMAND_EVENT,
	INSPECTOR_PAGE_SCRIPT,
} from './inspector-script';

describe( 'site preview inspector sessions', () => {
	afterEach( () => {
		vi.restoreAllMocks();
		document.body.replaceChildren();
		delete ( window as Window & { __studioInspectorMounted?: boolean } ).__studioInspectorMounted;
		delete ( window as Window & { __studioInspectorState?: unknown[] } ).__studioInspectorState;
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

	it( 'clears the pending batch when annotation mode is cancelled', () => {
		const log = vi.spyOn( console, 'log' ).mockImplementation( () => undefined );
		( window as Window & { __studioInspectorState?: unknown[] } ).__studioInspectorState = [
			{
				id: 'saved',
				comment: 'Saved note',
				path: window.location.pathname + window.location.search,
				documentRect: { left: 10, top: 10, width: 100, height: 40 },
			},
		];

		new Function( INSPECTOR_PAGE_SCRIPT )();
		command( 'toggle-picking' );
		command( 'cancel' );

		expect( latestState( log ) ).toMatchObject( { isPicking: false, annotationCount: 0 } );
		expect(
			( window as Window & { __studioInspectorState?: unknown[] } ).__studioInspectorState
		).toEqual( [] );
	} );

	it( 'submits saved notes when an empty draft popup is open', () => {
		const log = vi.spyOn( console, 'log' ).mockImplementation( () => undefined );
		document.body.innerHTML = '<h1 id="draft">Draft</h1>';
		const draft = document.querySelector( '#draft' ) as HTMLElement;
		vi.spyOn( draft, 'getBoundingClientRect' ).mockReturnValue( rect( 10, 10 ) );
		( window as Window & { __studioInspectorState?: unknown[] } ).__studioInspectorState = [
			{
				id: 'saved',
				comment: 'Saved note',
				path: window.location.pathname + window.location.search,
				documentRect: { left: 10, top: 10, width: 100, height: 40 },
			},
		];

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
} );

function command( type: string ) {
	window.dispatchEvent( new CustomEvent( INSPECTOR_COMMAND_EVENT, { detail: { type } } ) );
}

function rect( left: number, top: number ): DOMRect {
	return {
		x: left,
		y: top,
		left,
		top,
		right: left + 100,
		bottom: top + 40,
		width: 100,
		height: 40,
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
