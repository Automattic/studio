import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { SettingsDialog } from '@/features/settings';
import { renderWithProviders } from '@/test/render';
import { useBrowserShortcuts } from './use-browser-shortcuts';
import type { BrowserShortcutCommand } from '@studio/agent/protocol/inspector/page-script';

function Navigation( { onCommand }: { onCommand: ( command: BrowserShortcutCommand ) => void } ) {
	const shortcuts = useBrowserShortcuts( true, onCommand );
	return <span data-testid="back">{ shortcuts.back.ariaKeyShortcut }</span>;
}

afterEach( () => vi.restoreAllMocks() );

it.each( [ 'MacIntel', 'Win32' ] )( 'navigates with the platform modifier on %s', ( platform ) => {
	vi.spyOn( navigator, 'platform', 'get' ).mockReturnValue( platform );
	const onCommand = vi.fn();
	render( <Navigation onCommand={ onCommand } /> );
	const modifier = { metaKey: platform === 'MacIntel', ctrlKey: platform !== 'MacIntel' };
	fireEvent.keyDown( document.body, { key: '[', ...modifier } );
	fireEvent.keyDown( document.body, { key: ']', ...modifier } );
	fireEvent.keyDown( document.body, { key: '[', ...modifier, shiftKey: true } );
	fireEvent.keyDown( document.body, { key: '[', ...modifier, repeat: true } );
	expect( onCommand.mock.calls ).toEqual( [ [ 'back' ], [ 'forward' ] ] );
	expect( screen.getByTestId( 'back' ) ).toHaveTextContent(
		platform === 'MacIntel' ? 'Meta+[' : 'Control+['
	);
} );

it( 'routes to settings while the settings dialog is open', async () => {
	const onCommand = vi.fn();
	const { history, user } = renderWithProviders(
		<>
			<Navigation onCommand={ onCommand } />
			<SettingsDialog />
		</>,
		{ path: '/?settings=general' }
	);
	await user.click( await screen.findByRole( 'tab', { name: 'Appearance' } ) );
	await waitFor( () => expect( history.location.search ).toContain( 'appearance' ) );
	fireEvent.keyDown( screen.getByRole( 'textbox', { name: 'Search settings' } ), {
		key: '[',
		ctrlKey: true,
	} );
	await waitFor( () => expect( history.location.search ).toContain( 'settings=general' ) );
	expect( onCommand ).not.toHaveBeenCalled();
} );
