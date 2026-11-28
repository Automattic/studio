/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { observePreviewThemeColor } from '../preview-theme-color';

beforeEach( () => {
	document.head.innerHTML = '';
	document.body.innerHTML = '';
	let fill = '#000000';
	vi.spyOn( HTMLCanvasElement.prototype, 'getContext' ).mockReturnValue( {
		get fillStyle() {
			return fill;
		},
		set fillStyle( value: string ) {
			if ( /^#[\da-f]{6}$/i.test( value ) ) fill = value;
		},
		clearRect() {},
		fillRect() {},
		getImageData: () => ( {
			data: new Uint8ClampedArray( [
				...[ 1, 3, 5 ].map( ( index ) => parseInt( fill.slice( index, index + 2 ), 16 ) ),
				255,
			] ),
		} ),
	} as unknown as CanvasRenderingContext2D );
} );

afterEach( () => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
	document.head.innerHTML = '';
	document.body.innerHTML = '';
} );

describe( 'declared preview colors', () => {
	it( 'follows valid metadata changes and restores the fallback when it is removed', async () => {
		document.head.innerHTML =
			'<meta name="theme-color" content="invalid"><meta name="theme-color" content="#123456">';
		const report = vi.fn();
		const stop = observePreviewThemeColor( report );
		await vi.waitFor( () => expect( report ).toHaveBeenLastCalledWith( '#123456' ) );
		document.head.lastElementChild!.setAttribute( 'content', '#abcdef' );
		await vi.waitFor( () => expect( report ).toHaveBeenLastCalledWith( '#abcdef' ) );
		document.head.innerHTML = '';
		await vi.waitFor( () => expect( report ).toHaveBeenLastCalledWith( null ) );
		stop();
	} );

	it( 'follows the media condition on a declared color', async () => {
		const query = Object.assign( new EventTarget(), { matches: false } );
		vi.stubGlobal( 'matchMedia', () => query );
		document.head.innerHTML =
			'<meta name="theme-color" media="(prefers-color-scheme: dark)" content="#123456"><meta name="theme-color" content="#abcdef">';
		const report = vi.fn();
		const stop = observePreviewThemeColor( report );
		await vi.waitFor( () => expect( report ).toHaveBeenLastCalledWith( '#abcdef' ) );
		query.matches = true;
		query.dispatchEvent( new Event( 'change' ) );
		await vi.waitFor( () => expect( report ).toHaveBeenLastCalledWith( '#123456' ) );
		stop();
	} );

	it( 'uses the fallback for a colored page or manifest without theme-color metadata', async () => {
		document.head.innerHTML = '<link rel="manifest" href="/manifest.json">';
		document.body.innerHTML = '<header style="background:#123456">Site</header>';
		const fetch = vi.fn();
		vi.stubGlobal( 'fetch', fetch );
		const report = vi.fn();
		const stop = observePreviewThemeColor( report );
		await vi.waitFor( () => expect( report ).toHaveBeenLastCalledWith( null ) );
		expect( fetch ).not.toHaveBeenCalled();
		stop();
	} );
} );
