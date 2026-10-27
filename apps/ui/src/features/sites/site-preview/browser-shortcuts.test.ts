import { describe, expect, it } from 'vitest';
import { getBrowserShortcutCommand } from './browser-shortcuts';

describe( 'getBrowserShortcutCommand', () => {
	// jsdom reports a non-Apple platform: primary modifier is Ctrl and the
	// navigation-arrow alias uses Alt.
	function makeEvent( overrides: Record< string, unknown > ) {
		return {
			defaultPrevented: false,
			repeat: false,
			key: '',
			altKey: false,
			ctrlKey: false,
			metaKey: false,
			shiftKey: false,
			target: null,
			...overrides,
		} as unknown as KeyboardEvent;
	}

	it( 'maps the primary-modifier chords to commands', () => {
		expect( getBrowserShortcutCommand( makeEvent( { key: 'r', ctrlKey: true } ) ) ).toBe(
			'reload'
		);
		// The ⌘⇧R alias reports an uppercase key; it must still map to reload.
		expect(
			getBrowserShortcutCommand( makeEvent( { key: 'R', ctrlKey: true, shiftKey: true } ) )
		).toBe( 'reload' );
		expect( getBrowserShortcutCommand( makeEvent( { key: '[', ctrlKey: true } ) ) ).toBe( 'back' );
		expect( getBrowserShortcutCommand( makeEvent( { key: ']', ctrlKey: true } ) ) ).toBe(
			'forward'
		);
	} );

	it( 'maps the Alt+arrow aliases to back/forward', () => {
		expect( getBrowserShortcutCommand( makeEvent( { key: 'ArrowLeft', altKey: true } ) ) ).toBe(
			'back'
		);
		expect( getBrowserShortcutCommand( makeEvent( { key: 'ArrowRight', altKey: true } ) ) ).toBe(
			'forward'
		);
	} );

	it( 'ignores arrows with the wrong modifier, extra modifiers, or while editing text', () => {
		expect( getBrowserShortcutCommand( makeEvent( { key: 'ArrowLeft', ctrlKey: true } ) ) ).toBe(
			null
		);
		expect(
			getBrowserShortcutCommand( makeEvent( { key: 'ArrowLeft', altKey: true, shiftKey: true } ) )
		).toBe( null );
		expect(
			getBrowserShortcutCommand(
				makeEvent( {
					key: 'ArrowLeft',
					altKey: true,
					target: document.createElement( 'textarea' ),
				} )
			)
		).toBe( null );
	} );

	it( 'ignores repeated and already handled keys', () => {
		expect(
			getBrowserShortcutCommand( makeEvent( { key: 'r', ctrlKey: true, repeat: true } ) )
		).toBe( null );
		expect(
			getBrowserShortcutCommand( makeEvent( { key: 'r', ctrlKey: true, defaultPrevented: true } ) )
		).toBe( null );
	} );
} );
