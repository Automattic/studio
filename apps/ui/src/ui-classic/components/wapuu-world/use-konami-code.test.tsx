import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useKonamiCode } from './use-konami-code';

const KONAMI = [
	'ArrowUp',
	'ArrowUp',
	'ArrowDown',
	'ArrowDown',
	'ArrowLeft',
	'ArrowRight',
	'ArrowLeft',
	'ArrowRight',
	'b',
	'a',
];

function press( key: string ) {
	act( () => {
		window.dispatchEvent( new KeyboardEvent( 'keydown', { key } ) );
	} );
}

function pressSequence( keys: string[] ) {
	keys.forEach( press );
}

describe( 'useKonamiCode', () => {
	beforeEach( () => {
		vi.useFakeTimers();
	} );

	afterEach( () => {
		vi.useRealTimers();
	} );

	it( 'calls onActivate once the full sequence is entered', () => {
		const onActivate = vi.fn();
		renderHook( () => useKonamiCode( onActivate ) );

		pressSequence( KONAMI );

		expect( onActivate ).toHaveBeenCalledTimes( 1 );
	} );

	it( 'does not activate for a partial sequence', () => {
		const onActivate = vi.fn();
		renderHook( () => useKonamiCode( onActivate ) );

		pressSequence( KONAMI.slice( 0, KONAMI.length - 1 ) );

		expect( onActivate ).not.toHaveBeenCalled();
	} );

	it( 'resets after a wrong key and requires the full sequence again', () => {
		const onActivate = vi.fn();
		renderHook( () => useKonamiCode( onActivate ) );

		pressSequence( KONAMI.slice( 0, 4 ) );
		press( 'x' );
		pressSequence( KONAMI.slice( 0, KONAMI.length - 1 ) );
		expect( onActivate ).not.toHaveBeenCalled();

		press( 'a' );
		expect( onActivate ).toHaveBeenCalledTimes( 1 );
	} );

	it( 'resets progress after the timeout gap between keys', () => {
		const onActivate = vi.fn();
		renderHook( () => useKonamiCode( onActivate ) );

		pressSequence( KONAMI.slice( 0, 4 ) );
		act( () => {
			vi.advanceTimersByTime( 2001 );
		} );
		pressSequence( KONAMI.slice( 4 ) );

		expect( onActivate ).not.toHaveBeenCalled();
	} );

	it( 'treats a wrong key that is the first sequence key as a fresh start', () => {
		const onActivate = vi.fn();
		renderHook( () => useKonamiCode( onActivate ) );

		press( 'ArrowDown' ); // wrong first key, but also KONAMI[2]
		press( 'ArrowUp' ); // restart at index 1
		pressSequence( KONAMI.slice( 1 ) );

		expect( onActivate ).toHaveBeenCalledTimes( 1 );
	} );
} );
