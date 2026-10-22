import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { createPortal } from 'react-dom';
import { describe, expect, it, vi } from 'vitest';
import {
	closeOnPaletteShortcut,
	setCommandPaletteOpen,
	useCommandPaletteOpen,
} from './use-command-palette';

describe( 'closeOnPaletteShortcut', () => {
	it( 'closes the dialog for the palette, unless the key comes from a dialog over it', () => {
		const close = vi.fn();
		const { result } = renderHook( () => useCommandPaletteOpen() );
		render(
			<div onKeyDown={ closeOnPaletteShortcut( close ) }>
				<input aria-label="Search settings" />
				{ createPortal( <input aria-label="Confirm" />, document.body ) }
			</div>
		);

		fireEvent.keyDown( screen.getByRole( 'textbox', { name: 'Confirm' } ), {
			key: 'k',
			code: 'KeyK',
			ctrlKey: true,
		} );
		expect( close ).not.toHaveBeenCalled();

		fireEvent.keyDown( screen.getByRole( 'textbox', { name: 'Search settings' } ), {
			key: 'k',
			code: 'KeyK',
			ctrlKey: true,
		} );
		expect( close ).toHaveBeenCalled();
		expect( result.current ).toBe( true );
		act( () => setCommandPaletteOpen( false ) );
	} );
} );
