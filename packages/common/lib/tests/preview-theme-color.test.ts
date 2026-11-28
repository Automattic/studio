/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { observePreviewThemeColor } from '../preview-theme-color';

let header: HTMLElement;

beforeEach( () => {
	document.head.innerHTML = '';
	document.body.innerHTML = '<header></header>';
	header = document.querySelector( 'header' )!;
	header.style.backgroundColor = 'rgb(20, 40, 60)';
	Object.defineProperty( document.documentElement, 'clientWidth', {
		value: 600,
		configurable: true,
	} );
	Object.defineProperty( document, 'elementFromPoint', {
		value: () => header,
		configurable: true,
	} );
	vi.stubGlobal(
		'ResizeObserver',
		class {
			observe() {}
			disconnect() {}
		}
	);
	vi.stubGlobal( 'matchMedia', ( query: string ) => ( {
		matches: ! query.includes( 'dark' ),
		addEventListener() {},
		removeEventListener() {},
	} ) );
	vi.spyOn( window, 'getComputedStyle' ).mockImplementation(
		( element ) =>
			( {
				backgroundImage: element === header ? header.style.backgroundImage || 'none' : 'none',
				backgroundColor: element === header ? header.style.backgroundColor : 'rgba(0, 0, 0, 0)',
				opacity: '1',
			} ) as CSSStyleDeclaration
	);
	let fill = '#000000';
	const context = {
		get fillStyle() {
			return fill;
		},
		set fillStyle( value: string ) {
			if ( /^#[\da-f]{6}$/i.test( value ) ) fill = value.toLowerCase();
			else {
				const match = value.match( /^rgba?\(\s*(\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\s*\)$/ );
				if ( match ) {
					const values = match.slice( 1, 4 ).map( Number );
					fill = `#${ values.map( ( n ) => n.toString( 16 ).padStart( 2, '0' ) ).join( '' ) }${
						match[ 4 ] === '0' ? '00' : ''
					}`;
				}
			}
		},
		clearRect() {},
		fillRect() {},
		getImageData() {
			return {
				data: new Uint8ClampedArray( [
					parseInt( fill.slice( 1, 3 ), 16 ),
					parseInt( fill.slice( 3, 5 ), 16 ),
					parseInt( fill.slice( 5, 7 ), 16 ),
					fill.endsWith( '00' ) && fill.length === 9 ? 0 : 255,
				] ),
			};
		},
	};
	vi.spyOn( HTMLCanvasElement.prototype, 'getContext' ).mockReturnValue(
		context as unknown as CanvasRenderingContext2D
	);
} );

afterEach( () => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
	document.head.innerHTML = '';
	document.body.innerHTML = '';
} );

describe( 'preview page colors', () => {
	it( 'honors matching metadata and follows changes to it', async () => {
		document.head.innerHTML =
			'<meta name="theme-color" media="(prefers-color-scheme: dark)" content="#ffffff"><meta name="theme-color" content="#123456">';
		const report = vi.fn();
		const stop = observePreviewThemeColor( report );
		await vi.waitFor( () => expect( report ).toHaveBeenLastCalledWith( '#123456' ) );
		document.head.lastElementChild!.setAttribute( 'content', '#abcdef' );
		await vi.waitFor( () => expect( report ).toHaveBeenLastCalledWith( '#abcdef' ) );
		stop();
	} );

	it( 'uses a solid visible header, then reports no color for an unreliable header', async () => {
		const report = vi.fn();
		const stop = observePreviewThemeColor( report );
		await vi.waitFor( () => expect( report ).toHaveBeenLastCalledWith( '#14283c' ) );
		header.style.backgroundImage = 'linear-gradient(red, blue)';
		await vi.waitFor( () => expect( report ).toHaveBeenLastCalledWith( null ) );
		stop();
	} );

	it( 'updates a solid header when an ancestor changes its appearance', async () => {
		document.body.innerHTML = '<main><header></header></main>';
		header = document.querySelector( 'header' )!;
		const main = document.querySelector( 'main' )!;
		vi.mocked( window.getComputedStyle ).mockImplementation(
			( element ) =>
				( {
					backgroundImage: 'none',
					backgroundColor:
						element !== header
							? 'rgba(0, 0, 0, 0)'
							: document.body.classList.contains( 'blue' )
							? 'rgb(18, 52, 86)'
							: main.classList.contains( 'green' )
							? 'rgb(14, 76, 53)'
							: 'rgb(20, 40, 60)',
					opacity: '1',
				} ) as CSSStyleDeclaration
		);
		const report = vi.fn();
		const stop = observePreviewThemeColor( report );
		await vi.waitFor( () => expect( report ).toHaveBeenLastCalledWith( '#14283c' ) );
		document.body.classList.add( 'blue' );
		await vi.waitFor( () => expect( report ).toHaveBeenLastCalledWith( '#123456' ) );
		document.body.classList.remove( 'blue' );
		main.classList.add( 'green' );
		await vi.waitFor( () => expect( report ).toHaveBeenLastCalledWith( '#0e4c35' ) );
		stop();
	} );

	it( 'uses an accessible manifest color ahead of the header', async () => {
		document.head.innerHTML = '<link rel="manifest" href="/manifest.json">';
		const fetch = vi.fn( async () => new Response( JSON.stringify( { theme_color: '#aabbcc' } ) ) );
		vi.stubGlobal( 'fetch', fetch );
		const report = vi.fn();
		const stop = observePreviewThemeColor( report );
		await vi.waitFor( () => expect( report ).toHaveBeenLastCalledWith( '#aabbcc' ) );
		expect( fetch ).toHaveBeenCalledOnce();
		stop();
	} );

	it( 'waits for the manifest before reporting a lower-priority color', async () => {
		document.head.innerHTML = '<link rel="manifest" href="/manifest.json">';
		let finishManifest: ( response: Response ) => void = () => {};
		const fetch = vi.fn(
			() => new Promise< Response >( ( resolve ) => ( finishManifest = resolve ) )
		);
		vi.stubGlobal( 'fetch', fetch );
		const report = vi.fn();
		const stop = observePreviewThemeColor( report );
		await vi.waitFor( () => expect( fetch ).toHaveBeenCalledOnce() );
		expect( report ).not.toHaveBeenCalled();
		finishManifest( new Response( JSON.stringify( { theme_color: '#aabbcc' } ) ) );
		await vi.waitFor( () => expect( report ).toHaveBeenLastCalledWith( '#aabbcc' ) );
		stop();
	} );

	it( 'uses the header if the manifest cannot be fetched', async () => {
		document.head.innerHTML = '<link rel="manifest" href="/manifest.json">';
		vi.stubGlobal(
			'fetch',
			vi.fn( async () => {
				throw new Error( 'offline' );
			} )
		);
		const report = vi.fn();
		const stop = observePreviewThemeColor( report );
		await vi.waitFor( () => expect( report ).toHaveBeenLastCalledWith( '#14283c' ) );
		stop();
	} );
} );
