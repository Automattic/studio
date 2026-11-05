import { INSPECTOR_BRIDGE_PREFIX } from '@studio/agent/protocol/inspector/page-script';
import {
	READ_ADMIN_BAR_VISIBILITY_SCRIPT,
	READ_AUTO_LOGIN_SCRIPT,
} from '@studio/common/lib/preview-shortcuts-script';
import { act, fireEvent, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { renderWithProviders } from '@/test/render';
import { WebviewSurface } from './webview-surface';

it.each( [ true, false ] )(
	'announces only a confirmed new desktop session (confirmation: %s)',
	async ( confirmation ) => {
		const onAutoLogin = vi.fn();
		const view = renderWithProviders(
			<WebviewSurface
				url="http://localhost:9010"
				reloadNonce={ 0 }
				inspector={ false }
				onAutoLogin={ onAutoLogin }
			/>
		);
		await waitFor( () => expect( view.container.querySelector( 'webview' ) ).not.toBeNull() );
		const guest = view.container.querySelector( 'webview' )!;
		let pending = confirmation;
		Object.assign( guest, {
			getWebContentsId: () => 42,
			executeJavaScript: vi.fn( async ( script: string ) => {
				if ( script !== READ_AUTO_LOGIN_SCRIPT ) return '';
				const result = pending;
				pending = false;
				return result;
			} ),
		} );
		fireEvent( guest, new Event( 'dom-ready' ) );
		fireEvent( guest, new Event( 'did-stop-loading' ) );
		await act( async () => {} );
		expect( onAutoLogin ).toHaveBeenCalledTimes( confirmation ? 1 : 0 );
	}
);

it( 'ignores an automatic login confirmation after navigation or unmount', async () => {
	const onAutoLogin = vi.fn();
	const view = renderWithProviders(
		<WebviewSurface
			url="http://localhost:9010"
			reloadNonce={ 0 }
			inspector={ false }
			onAutoLogin={ onAutoLogin }
		/>
	);
	await waitFor( () => expect( view.container.querySelector( 'webview' ) ).not.toBeNull() );
	const guest = view.container.querySelector( 'webview' )!;
	let finish = ( _value: boolean ) => {};
	Object.assign( guest, {
		getWebContentsId: () => 42,
		executeJavaScript: vi.fn( ( script: string ) =>
			script === READ_AUTO_LOGIN_SCRIPT
				? new Promise< boolean >( ( resolve ) => {
						finish = resolve;
				  } )
				: Promise.resolve( '' )
		),
	} );
	fireEvent( guest, new Event( 'dom-ready' ) );
	fireEvent(
		guest,
		Object.assign( new Event( 'did-start-navigation' ), { isMainFrame: true, isInPlace: false } )
	);
	await act( async () => finish( true ) );
	fireEvent( guest, new Event( 'dom-ready' ) );
	view.unmount();
	await act( async () => finish( true ) );
	expect( onAutoLogin ).not.toHaveBeenCalled();
} );

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
