import { fireEvent, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { renderWithProviders } from '@/test/render';
import { ColorTintSettings } from './color-tint-settings';

it( 'commits only complete hex values and restores incomplete input on blur', async () => {
	const onCommit = vi.fn();
	renderWithProviders( <ColorTintSettings tint={ {} } onCommit={ onCommit } /> );
	const input = await screen.findByRole( 'textbox', { name: 'Hex color' } );
	fireEvent.change( input, { target: { value: '#12' } } );
	expect( onCommit ).not.toHaveBeenCalled();
	fireEvent.change( input, { target: { value: 'ABCDEF' } } );
	expect( onCommit ).toHaveBeenLastCalledWith( {
		accentColor: '#abcdef',
		tintIntensity: 0,
		contrast: 0,
	} );
	fireEvent.change( input, { target: { value: 'invalid' } } );
	fireEvent.blur( input );
	expect( input ).toHaveValue( '#abcdef' );
	expect( onCommit ).toHaveBeenCalledTimes( 1 );
} );
