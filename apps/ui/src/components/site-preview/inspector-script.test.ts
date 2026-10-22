import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	INSPECTOR_BRIDGE_PREFIX,
	INSPECTOR_COMMAND_EVENT,
	INSPECTOR_PAGE_SCRIPT,
	parseInspectorMessage,
} from './inspector-script';

function mount() {
	const log = vi.spyOn( console, 'log' ).mockImplementation( () => undefined );
	vi.stubGlobal( 'requestAnimationFrame', () => 0 );
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
		const marker = root.querySelector( 'button' ) as HTMLButtonElement;
		expect( marker ).toHaveTextContent( '1' );
		marker.click();
		expect( events().at( -1 ) ).toMatchObject( { type: 'edit', id: 'n1' } );
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
