import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useAppZoomFactor } from './use-app-zoom-factor';

describe( 'useAppZoomFactor', () => {
	afterEach( () => {
		vi.unstubAllGlobals();
	} );

	it( 'is 1 without the Electron preload', () => {
		const { result } = renderHook( () => useAppZoomFactor() );

		expect( result.current ).toBe( 1 );
	} );

	it( 'reads the app zoom factor and follows it across resizes', () => {
		const getAppZoomFactor = vi.fn().mockReturnValue( 1.25 );
		vi.stubGlobal( 'ipcApi', { getAppZoomFactor } );
		const { result } = renderHook( () => useAppZoomFactor() );

		expect( result.current ).toBe( 1.25 );

		// Zooming the page resizes its layout viewport.
		getAppZoomFactor.mockReturnValue( 1.5 );
		act( () => {
			window.dispatchEvent( new Event( 'resize' ) );
		} );

		expect( result.current ).toBe( 1.5 );
	} );

	it( 'falls back to 1 for a value that is not a usable factor', () => {
		vi.stubGlobal( 'ipcApi', { getAppZoomFactor: () => Number.NaN } );

		expect( renderHook( () => useAppZoomFactor() ).result.current ).toBe( 1 );
	} );
} );
