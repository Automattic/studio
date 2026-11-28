import { INSPECTOR_BRIDGE_PREFIX } from '@studio/agent/protocol/inspector/page-script';
import { READ_ADMIN_BAR_VISIBILITY_SCRIPT } from '@studio/common/lib/preview-shortcuts-script';
import { act, fireEvent, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { renderWithProviders } from '@/test/render';
import { WebviewSurface } from './webview-surface';

it( 'reads actual toolbar visibility after load and ignores an older document response', async () => {
	const onAdminBarVisibilityChange = vi.fn();
	const view = renderWithProviders(
		<WebviewSurface
			url="http://localhost:9010"
			reloadNonce={ 0 }
			inspector={ false }
			onAdminBarVisibilityChange={ onAdminBarVisibilityChange }
		/>
	);
	await waitFor( () => expect( view.container.querySelector( 'webview' ) ).not.toBeNull() );
	const guest = view.container.querySelector( 'webview' )!;
	let resolveVisibility: ( visible: boolean ) => void = () => {};
	Object.assign( guest, {
		getWebContentsId: () => 42,
		executeJavaScript: vi.fn( ( script: string ) =>
			script === READ_ADMIN_BAR_VISIBILITY_SCRIPT
				? new Promise< boolean >( ( resolve ) => {
						resolveVisibility = resolve;
				  } )
				: Promise.resolve( '' )
		),
	} );
	fireEvent( guest, new Event( 'dom-ready' ) );
	await act( async () => resolveVisibility( true ) );
	expect( onAdminBarVisibilityChange ).toHaveBeenLastCalledWith( true );
	fireEvent( guest, new Event( 'did-stop-loading' ) );
	const finishOldDocument = resolveVisibility;
	fireEvent(
		guest,
		Object.assign( new Event( 'did-start-navigation' ), { isMainFrame: true, isInPlace: false } )
	);
	await act( async () => finishOldDocument( true ) );
	expect( onAdminBarVisibilityChange ).toHaveBeenLastCalledWith( null );
	fireEvent( guest, new Event( 'did-navigate' ) );
	fireEvent( guest, new Event( 'did-stop-loading' ) );
	await act( async () => resolveVisibility( false ) );
	expect( onAdminBarVisibilityChange ).toHaveBeenLastCalledWith( false );
} );

it( 'follows color changes and ignores reports from an old webview document', async () => {
	const onThemeColorChange = vi.fn();
	const view = renderWithProviders(
		<WebviewSurface
			url="http://localhost:9010"
			reloadNonce={ 0 }
			inspector={ false }
			themeColorActive
			onThemeColorChange={ onThemeColorChange }
		/>
	);
	await waitFor( () => expect( view.container.querySelector( 'webview' ) ).not.toBeNull() );
	const guest = view.container.querySelector( 'webview' )!;
	const pending: ( ( value: unknown ) => void )[] = [];
	const executeJavaScript = vi.fn( ( script: string ) =>
		script.includes( 'const token =' ) || script.includes( '__studioPreviewThemeColor.wait(' )
			? new Promise< unknown >( ( resolve ) => pending.push( resolve ) )
			: Promise.resolve( undefined )
	);
	Object.assign( guest, { getWebContentsId: () => 42, executeJavaScript } );
	fireEvent( guest, new Event( 'dom-ready' ) );
	await waitFor( () => expect( pending ).toHaveLength( 1 ) );
	const script = executeJavaScript.mock.calls.find( ( [ source ] ) =>
		source.includes( 'const token =' )
	)![ 0 ];
	const token = script.match( /const token = "([^"]+)"/ )![ 1 ];
	await act( async () => pending[ 0 ]( { token, version: 1, color: '#123456' } ) );
	expect( onThemeColorChange ).toHaveBeenLastCalledWith( '#123456' );
	await waitFor( () => expect( pending ).toHaveLength( 2 ) );
	await act( async () => pending[ 1 ]( { token, version: 2, color: '#abcdef' } ) );
	expect( onThemeColorChange ).toHaveBeenLastCalledWith( '#abcdef' );
	await waitFor( () => expect( pending ).toHaveLength( 3 ) );
	fireEvent(
		guest,
		Object.assign( new Event( 'did-start-navigation' ), { isMainFrame: true, isInPlace: false } )
	);
	await act( async () => pending[ 2 ]( { token, version: 3, color: '#654321' } ) );
	expect( onThemeColorChange ).toHaveBeenCalledTimes( 2 );
	fireEvent( guest, new Event( 'dom-ready' ) );
	await waitFor( () => expect( pending ).toHaveLength( 4 ) );
	const nextScript = executeJavaScript.mock.calls.filter( ( [ source ] ) =>
		source.includes( 'const token =' )
	)[ 1 ][ 0 ];
	const nextToken = nextScript.match( /const token = "([^"]+)"/ )![ 1 ];
	await act( async () => pending[ 3 ]( { token: nextToken, version: 1, color: null } ) );
	expect( onThemeColorChange ).toHaveBeenLastCalledWith( null );
} );

it( 'falls back when the webview never reports a theme color', async () => {
	const onThemeColorChange = vi.fn();
	const view = renderWithProviders(
		<WebviewSurface
			url="http://localhost:9010"
			reloadNonce={ 0 }
			inspector={ false }
			themeColorActive
			onThemeColorChange={ onThemeColorChange }
		/>
	);
	await waitFor( () => expect( view.container.querySelector( 'webview' ) ).not.toBeNull() );
	const guest = view.container.querySelector( 'webview' )!;
	vi.useFakeTimers();
	try {
		let token = '';
		let reportColor: ( value: unknown ) => void = () => {};
		Object.assign( guest, {
			getWebContentsId: () => 42,
			executeJavaScript: vi.fn( ( script: string ) => {
				if ( script.includes( '__studioPreviewThemeColor.wait(' ) ) return new Promise( () => {} );
				if ( ! script.includes( 'const token =' ) ) return Promise.resolve( undefined );
				token = script.match( /const token = "([^"]+)"/ )![ 1 ];
				return new Promise( ( resolve ) => ( reportColor = resolve ) );
			} ),
		} );
		fireEvent( guest, new Event( 'dom-ready' ) );
		expect( onThemeColorChange ).not.toHaveBeenCalled();
		await act( async () => vi.advanceTimersByTime( 4000 ) );
		expect( onThemeColorChange ).toHaveBeenLastCalledWith( null );
		await act( async () => reportColor( { token, version: 1, color: '#123456' } ) );
		expect( onThemeColorChange ).toHaveBeenLastCalledWith( '#123456' );
	} finally {
		vi.useRealTimers();
	}
} );

it( 'maps scaled guest annotation anchors into host coordinates', async () => {
	const onInspectorEvent = vi.fn();
	const view = renderWithProviders(
		<WebviewSurface
			url="http://localhost:9010"
			reloadNonce={ 0 }
			onInspectorEvent={ onInspectorEvent }
		/>
	);
	await waitFor( () => expect( view.container.querySelector( 'webview' ) ).not.toBeNull() );
	const guest = view.container.querySelector( 'webview' )!;
	Object.defineProperties( guest, { clientWidth: { value: 400 }, clientHeight: { value: 800 } } );
	vi.spyOn( guest, 'getBoundingClientRect' ).mockReturnValue( {
		left: 300,
		top: 100,
		width: 200,
		height: 400,
	} as DOMRect );
	act( () => {
		fireEvent(
			guest,
			Object.assign( new Event( 'console-message' ), {
				message:
					INSPECTOR_BRIDGE_PREFIX +
					JSON.stringify( { type: 'anchor', id: 'note', anchor: { left: 100, top: 200 } } ),
			} )
		);
	} );
	expect( onInspectorEvent ).toHaveBeenCalledWith( {
		type: 'anchor',
		id: 'note',
		anchor: { left: 350, top: 200 },
	} );
} );
