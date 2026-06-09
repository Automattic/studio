import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SessionUIProvider, useSessionPreviewUI } from './use-session-ui';

const originalIpcListener = Object.getOwnPropertyDescriptor( window, 'ipcListener' );

afterEach( () => {
	if ( originalIpcListener ) {
		Object.defineProperty( window, 'ipcListener', originalIpcListener );
	} else {
		delete ( window as typeof window & { ipcListener?: unknown } ).ipcListener;
	}
} );

function PreviewStatus( { label }: { label: string } ) {
	const preview = useSessionPreviewUI();
	return (
		<span>
			{ `${ label }:${ preview.open ? 'open' : 'closed' }:${ preview.path }:${
				preview.reloadNonce
			}` }
		</span>
	);
}

function PreviewToggle() {
	const preview = useSessionPreviewUI();
	return <button onClick={ preview.toggle }>Toggle preview</button>;
}

function PreviewNavigate() {
	const preview = useSessionPreviewUI();
	return <button onClick={ () => preview.navigate( '/wp-admin/' ) }>Navigate preview</button>;
}

function PreviewPathUpdate() {
	const preview = useSessionPreviewUI();
	return <button onClick={ () => preview.updatePath( '/about/' ) }>Update preview path</button>;
}

describe( 'SessionUIProvider', () => {
	it( 'does not reset preview state when nested inside an existing provider', () => {
		render(
			<SessionUIProvider>
				<PreviewStatus label="outer" />
				<SessionUIProvider>
					<PreviewToggle />
					<PreviewStatus label="inner" />
				</SessionUIProvider>
			</SessionUIProvider>
		);

		expect( screen.getByText( 'outer:open:/:0' ) ).toBeVisible();
		expect( screen.getByText( 'inner:open:/:0' ) ).toBeVisible();

		fireEvent.click( screen.getByRole( 'button', { name: 'Toggle preview' } ) );

		expect( screen.getByText( 'outer:closed:/:0' ) ).toBeVisible();
		expect( screen.getByText( 'inner:closed:/:0' ) ).toBeVisible();
	} );

	it( 'opens, updates the preview path, and reloads when navigating', () => {
		render(
			<SessionUIProvider>
				<PreviewStatus label="preview" />
				<PreviewNavigate />
			</SessionUIProvider>
		);

		fireEvent.click( screen.getByRole( 'button', { name: 'Navigate preview' } ) );

		expect( screen.getByText( 'preview:open:/wp-admin/:1' ) ).toBeVisible();
	} );

	it( 'updates the preview path without forcing a reload', () => {
		render(
			<SessionUIProvider>
				<PreviewStatus label="preview" />
				<PreviewNavigate />
				<PreviewPathUpdate />
			</SessionUIProvider>
		);

		fireEvent.click( screen.getByRole( 'button', { name: 'Navigate preview' } ) );
		fireEvent.click( screen.getByRole( 'button', { name: 'Update preview path' } ) );

		expect( screen.getByText( 'preview:open:/about/:1' ) ).toBeVisible();
	} );

	it( 'toggles preview when the app menu event is received', () => {
		let menuListener: ( ( ...args: unknown[] ) => void ) | undefined;
		const unsubscribe = vi.fn();
		const subscribe = vi.fn( ( channel: string, listener: ( ...args: unknown[] ) => void ) => {
			menuListener = listener;
			return unsubscribe;
		} );
		Object.defineProperty( window, 'ipcListener', {
			configurable: true,
			value: { subscribe },
		} );

		const { unmount } = render(
			<SessionUIProvider>
				<PreviewStatus label="preview" />
			</SessionUIProvider>
		);

		expect( subscribe ).toHaveBeenCalledWith( 'toggle-site-preview', expect.any( Function ) );
		expect( screen.getByText( 'preview:open:/:0' ) ).toBeVisible();

		act( () => {
			menuListener?.();
		} );

		expect( screen.getByText( 'preview:closed:/:0' ) ).toBeVisible();

		unmount();

		expect( unsubscribe ).toHaveBeenCalled();
	} );
} );
