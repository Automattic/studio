import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useUiMode } from './use-ui-mode';

describe( 'useUiMode', () => {
	beforeEach( () => {
		window.localStorage.clear();
		window.history.replaceState( null, '', '/' );
	} );

	it( 'defaults to the Desks UI', () => {
		const { result } = renderHook( () => useUiMode() );

		expect( result.current.mode ).toBe( 'desks' );
	} );

	it( 'loads the saved internal UI mode from local storage', () => {
		window.localStorage.setItem( 'studio.uiMode', 'classic' );

		const { result } = renderHook( () => useUiMode() );

		expect( result.current.mode ).toBe( 'classic' );
	} );

	it( 'persists internal UI mode changes locally', () => {
		const { result } = renderHook( () => useUiMode() );

		act( () => result.current.setMode( 'classic' ) );

		expect( result.current.mode ).toBe( 'classic' );
		expect( window.localStorage.getItem( 'studio.uiMode' ) ).toBe( 'classic' );
	} );

	it( 'uses the Studio launch mode when provided', () => {
		window.localStorage.setItem( 'studio.uiMode', 'classic' );
		window.history.replaceState( null, '', '/?studio-ui-mode=desks' );

		const { result } = renderHook( () => useUiMode() );

		expect( result.current.mode ).toBe( 'desks' );
		expect( window.localStorage.getItem( 'studio.uiMode' ) ).toBe( 'desks' );
	} );

	it( 'maps the Agentic UI launch mode to the classic apps/ui surface', () => {
		window.history.replaceState( null, '', '/?studio-ui-mode=agentic' );

		const { result } = renderHook( () => useUiMode() );

		expect( result.current.mode ).toBe( 'classic' );
		expect( window.localStorage.getItem( 'studio.uiMode' ) ).toBe( 'classic' );
	} );

	it( 'does not toggle between internal UI modes with Ctrl+D', () => {
		const { result } = renderHook( () => useUiMode() );

		act( () => {
			window.dispatchEvent( new KeyboardEvent( 'keydown', { key: 'd', ctrlKey: true } ) );
		} );

		expect( result.current.mode ).toBe( 'desks' );
		expect( window.localStorage.getItem( 'studio.uiMode' ) ).toBeNull();
	} );
} );
