import { describe, expect, it } from 'vitest';
import { isShortcut } from './shortcuts';

const keydown = ( init: KeyboardEventInit ) =>
	new KeyboardEvent( 'keydown', { ctrlKey: true, ...init } );

describe( 'isShortcut', () => {
	it( 'reads the physical key when Option or the layout changes the typed one', () => {
		expect( isShortcut( keydown( { key: 'π', code: 'KeyP', altKey: true } ), 'p', 'alt' ) ).toBe(
			true
		);
		expect( isShortcut( keydown( { key: 'л', code: 'KeyK' } ), 'k' ) ).toBe( true );
		// AZERTY types a on the key QWERTY calls Q.
		expect(
			isShortcut( keydown( { key: 'a', code: 'KeyQ', shiftKey: true } ), 'a', 'shift' )
		).toBe( true );
	} );

	it( 'needs exactly the given modifiers, and leaves keys to a composing IME', () => {
		expect( isShortcut( keydown( { key: 'k', code: 'KeyK', shiftKey: true } ), 'k' ) ).toBe(
			false
		);
		expect( isShortcut( keydown( { key: 'k', code: 'KeyK', ctrlKey: false } ), 'k' ) ).toBe(
			false
		);
		expect( isShortcut( keydown( { key: 'k', code: 'KeyK', isComposing: true } ), 'k' ) ).toBe(
			false
		);
	} );
} );
