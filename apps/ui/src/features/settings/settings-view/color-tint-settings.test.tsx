import { fireEvent, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { renderWithProviders } from '@/test/render';
import { ColorTintSettings } from './color-tint-settings';

it( 'applies the green preset at 20 percent intensity while preserving contrast', async () => {
	const onCommit = vi.fn();
	renderWithProviders(
		<ColorTintSettings tint={ { tintIntensity: 28, contrast: 24 } } onCommit={ onCommit } />
	);
	fireEvent.click( await screen.findByRole( 'button', { name: 'Green' } ) );
	expect( onCommit ).toHaveBeenLastCalledWith( {
		accentColor: '#069e08',
		tintIntensity: 20,
		contrast: 24,
	} );
	expect( screen.getByRole( 'button', { name: 'Green' } ) ).toHaveAttribute(
		'aria-pressed',
		'true'
	);
	expect( screen.getByRole( 'textbox', { name: 'Hex color' } ) ).toHaveValue( '#069e08' );
	expect( screen.queryByRole( 'slider', { name: 'Hue' } ) ).not.toBeInTheDocument();
} );

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
