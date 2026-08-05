import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	INSPECTOR_BRIDGE_PREFIX,
	INSPECTOR_COMMAND_EVENT,
	createInspectorPageScript,
} from './inspector-script';

const BRIDGE_TOKEN = 'test-inspector-bridge-token';

describe( 'site preview inspector', () => {
	afterEach( () => {
		vi.restoreAllMocks();
		document.body.replaceChildren();
		delete ( window as Window & { __studioInspectorMounted?: boolean } ).__studioInspectorMounted;
		delete ( window as Window & { __studioInspectorState?: unknown[] } ).__studioInspectorState;
	} );

	it( 'keeps picking active while composing and after saving annotations', () => {
		const log = vi.spyOn( console, 'log' ).mockImplementation( () => undefined );
		document.body.innerHTML =
			'<main><h1 id="first">First target</h1><p id="second">Second target</p></main>';
		const first = document.querySelector( '#first' ) as HTMLElement;
		const second = document.querySelector( '#second' ) as HTMLElement;
		vi.spyOn( first, 'getBoundingClientRect' ).mockReturnValue( {
			x: 10,
			y: 0,
			top: 0,
			right: 210,
			bottom: 50,
			left: 10,
			width: 200,
			height: 50,
			toJSON: () => ( {} ),
		} );
		vi.spyOn( second, 'getBoundingClientRect' ).mockReturnValue( {
			x: 10,
			y: 100,
			top: 100,
			right: 210,
			bottom: 140,
			left: 10,
			width: 200,
			height: 40,
			toJSON: () => ( {} ),
		} );

		new Function( createInspectorPageScript( BRIDGE_TOKEN ) )();
		const host = document.querySelector( '#__studio-inspector-host' ) as HTMLElement;
		const root = host.shadowRoot as ShadowRoot;
		const command = ( type: string ) =>
			window.dispatchEvent(
				new CustomEvent( INSPECTOR_COMMAND_EVENT, {
					detail: { type, bridgeToken: BRIDGE_TOKEN },
				} )
			);
		const stateMessages = () =>
			log.mock.calls
				.map( ( [ message ] ) => message )
				.filter(
					( message ): message is string =>
						typeof message === 'string' && message.startsWith( INSPECTOR_BRIDGE_PREFIX )
				)
				.map( ( message ) => JSON.parse( message.slice( INSPECTOR_BRIDGE_PREFIX.length ) ) )
				.filter( ( message ) => message.type === 'state' );

		window.dispatchEvent(
			new CustomEvent( INSPECTOR_COMMAND_EVENT, {
				detail: { type: 'toggle-picking', bridgeToken: 'untrusted-page-token' },
			} )
		);
		first.dispatchEvent( new MouseEvent( 'click', { bubbles: true, cancelable: true } ) );
		expect( root.querySelector( '.popup' ) ).toBeNull();

		command( 'toggle-picking' );
		first.dispatchEvent( new MouseEvent( 'mousemove', { bubbles: true } ) );
		first.dispatchEvent( new MouseEvent( 'click', { bubbles: true, cancelable: true } ) );

		expect( root.querySelector( '.popup' ) ).not.toBeNull();
		expect( root.querySelector( '.highlight' ) ).not.toBeNull();
		expect( root.querySelectorAll( '.scrim' ) ).toHaveLength( 4 );
		expect( document.documentElement ).toHaveStyle( { overflow: 'hidden' } );
		const style = root.querySelector( 'style' )?.textContent ?? '';
		expect( style ).toContain( 'border-radius: 8px 8px 20px 8px' );
		expect( style ).toContain( 'backdrop-filter: blur(20px)' );
		expect( style ).toContain( 'min-height: 24px' );
		expect( style ).toContain( '0 0 0 1px rgba(0,0,0,0.9)' );
		expect( style ).toContain( 'background: rgba(0,0,0,0.52)' );

		const firstTextarea = root.querySelector( 'textarea' ) as HTMLTextAreaElement;
		firstTextarea.value = 'First line';
		firstTextarea.dispatchEvent( new InputEvent( 'input', { bubbles: true } ) );
		firstTextarea.setSelectionRange( firstTextarea.value.length, firstTextarea.value.length );
		firstTextarea.dispatchEvent(
			new KeyboardEvent( 'keydown', { key: 'Enter', metaKey: true, bubbles: true } )
		);
		expect( firstTextarea.value ).toBe( 'First line\n' );
		firstTextarea.value += 'Second line';
		firstTextarea.dispatchEvent( new InputEvent( 'input', { bubbles: true } ) );
		firstTextarea.dispatchEvent(
			new KeyboardEvent( 'keydown', { key: 'Enter', bubbles: true, cancelable: true } )
		);

		expect( root.querySelector( '.popup' ) ).toBeNull();
		expect( root.querySelectorAll( '.scrim' ) ).toHaveLength( 0 );
		expect( document.documentElement ).toHaveStyle( { overflow: '' } );
		expect( root.querySelectorAll( '.marker' ) ).toHaveLength( 1 );
		expect( root.querySelector( '.marker' ) ).toHaveStyle( { top: '12px' } );
		expect( root.querySelectorAll( '.annotation-highlight' ) ).toHaveLength( 1 );
		expect( stateMessages().at( -1 ) ).toMatchObject( {
			isPicking: true,
			annotationCount: 1,
		} );

		second.dispatchEvent( new MouseEvent( 'click', { bubbles: true, cancelable: true } ) );
		expect( root.querySelector( '.popup' ) ).not.toBeNull();
		expect( root.querySelector( '.highlight' ) ).not.toBeNull();
		const secondTextarea = root.querySelector( 'textarea' ) as HTMLTextAreaElement;
		secondTextarea.value = 'Second note';
		secondTextarea.dispatchEvent( new InputEvent( 'input', { bubbles: true } ) );
		expect( root.querySelector( '.send-to-chat' ) ).not.toBeNull();
		command( 'submit' );

		expect( root.querySelector( '.popup' ) ).toBeNull();
		expect( root.querySelectorAll( '.marker' ) ).toHaveLength( 0 );
		expect( root.querySelectorAll( '.annotation-highlight' ) ).toHaveLength( 0 );
		expect( stateMessages().at( -1 ) ).toMatchObject( {
			isPicking: false,
			annotationCount: 0,
		} );
		const doneMessage = log.mock.calls
			.map( ( [ message ] ) => message )
			.filter(
				( message ): message is string =>
					typeof message === 'string' && message.startsWith( INSPECTOR_BRIDGE_PREFIX )
			)
			.map( ( message ) => JSON.parse( message.slice( INSPECTOR_BRIDGE_PREFIX.length ) ) )
			.find( ( message ) => message.type === 'done' );
		expect( doneMessage.annotations ).toEqual(
			expect.arrayContaining( [
				expect.objectContaining( { comment: 'First line\nSecond line' } ),
				expect.objectContaining( { comment: 'Second note' } ),
			] )
		);
	} );

	it( 'cycles through overlapping elements at the selected point', () => {
		vi.spyOn( console, 'log' ).mockImplementation( () => undefined );
		document.body.innerHTML =
			'<div id="front">Front container</div><img id="behind" alt="Floating art">';
		const front = document.querySelector( '#front' ) as HTMLElement;
		const behind = document.querySelector( '#behind' ) as HTMLElement;
		const frontRect = {
			x: 10,
			y: 10,
			top: 10,
			right: 210,
			bottom: 210,
			left: 10,
			width: 200,
			height: 200,
			toJSON: () => ( {} ),
		};
		const behindRect = {
			...frontRect,
			x: 40,
			y: 40,
			top: 40,
			right: 140,
			bottom: 140,
			left: 40,
			width: 100,
			height: 100,
		};
		vi.spyOn( front, 'getBoundingClientRect' ).mockReturnValue( frontRect );
		vi.spyOn( behind, 'getBoundingClientRect' ).mockReturnValue( behindRect );

		new Function( createInspectorPageScript( BRIDGE_TOKEN ) )();
		const root = ( document.querySelector( '#__studio-inspector-host' ) as HTMLElement )
			.shadowRoot as ShadowRoot;
		window.dispatchEvent(
			new CustomEvent( INSPECTOR_COMMAND_EVENT, {
				detail: { type: 'toggle-picking', bridgeToken: BRIDGE_TOKEN },
			} )
		);
		front.dispatchEvent(
			new MouseEvent( 'click', { bubbles: true, cancelable: true, clientX: 80, clientY: 80 } )
		);

		expect( root.querySelector( '.layer-count' )?.textContent ).toBe( '1/2' );
		const initialPopup = root.querySelector( '.popup' ) as HTMLElement;
		const initialPosition = {
			left: initialPopup.style.left,
			top: initialPopup.style.top,
		};
		(
			root.querySelector( '[aria-label="Select next element at this point"]' ) as HTMLElement
		 ).click();
		expect( root.querySelector( '.target' )?.textContent ).toBe( 'img#behind' );
		expect( root.querySelector( '.layer-count' )?.textContent ).toBe( '2/2' );
		expect( root.querySelector( '.popup' ) ).toHaveStyle( initialPosition );

		const handle = root.querySelector( '.target-row' ) as HTMLElement;
		const popup = root.querySelector( '.popup' ) as HTMLElement;
		const startingLeft = Number.parseFloat( popup.style.left );
		handle.dispatchEvent(
			new MouseEvent( 'mousedown', { bubbles: true, button: 0, clientX: 100, clientY: 100 } )
		);
		window.dispatchEvent(
			new MouseEvent( 'mousemove', { bubbles: true, clientX: 130, clientY: 120 } )
		);
		window.dispatchEvent( new MouseEvent( 'mouseup', { bubbles: true } ) );
		expect( Number.parseFloat( popup.style.left ) ).toBe( startingLeft + 30 );

		window.dispatchEvent(
			new CustomEvent( INSPECTOR_COMMAND_EVENT, {
				detail: { type: 'cancel', bridgeToken: BRIDGE_TOKEN },
			} )
		);
	} );
} );
