import { INSPECTOR_BRIDGE_PREFIX } from '@studio/agent/protocol/inspector/page-script';
import { act, fireEvent, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { renderWithProviders } from '@/test/render';
import { WebviewSurface } from './webview-surface';

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
