import { screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Button, ColorPicker, Dialog, DialogContent, DialogTitle } from '@/lib/ui';
import { renderWithProviders } from '@/test/render';

function PickerExample( {
	initialValue = '#ff0000',
	onCommit = () => {},
}: {
	initialValue?: string;
	onCommit?: ( value: string ) => void;
} ) {
	const [ value, setValue ] = useState( initialValue );
	return (
		<>
			<ColorPicker value={ value } onValueChange={ setValue } onValueCommitted={ onCommit } />
			<Button onClick={ () => setValue( '#123456' ) }>Reset color</Button>
		</>
	);
}

describe( 'ColorPicker', () => {
	it( 'keeps the hex field editable and follows controlled updates', async () => {
		const onCommit = vi.fn();
		const { user } = renderWithProviders( <PickerExample onCommit={ onCommit } /> );
		const input = await screen.findByRole( 'textbox', { name: 'Hex color' } );
		await user.tab();
		expect( await screen.findByRole( 'dialog', { name: 'Color picker' } ) ).toBeVisible();
		expect( input ).toHaveFocus();
		await user.clear( input );
		await user.type( input, 'ABCDEF' );
		expect( input ).toHaveValue( 'ABCDEF' );
		expect( onCommit ).toHaveBeenCalledExactlyOnceWith( '#abcdef' );
		await user.click( screen.getByRole( 'button', { name: 'Reset color' } ) );
		await waitFor( () => expect( input ).toHaveValue( '#123456' ) );
		expect( screen.queryByRole( 'dialog', { name: 'Color picker' } ) ).not.toBeInTheDocument();
	} );

	it.each( [ '#808080', '#000000' ] )( 'preserves the selected hue for %s', async ( value ) => {
		const { user } = renderWithProviders( <PickerExample initialValue={ value } /> );
		await user.click( await screen.findByRole( 'textbox', { name: 'Hex color' } ) );
		await user.tab();
		expect(
			screen.getByRole( 'slider', { name: 'Saturation and brightness, Color picker' } )
		).toHaveFocus();
		await user.tab();
		const hue = screen.getByRole( 'slider', { name: 'Hue' } );
		expect( hue ).toHaveFocus();
		await user.keyboard( '{ArrowRight}' );
		await user.tab( { shift: true } );
		await user.keyboard( '{ArrowRight}{ArrowUp}' );
		expect( hue ).toHaveValue( '1' );
		expect( screen.getByRole( 'textbox', { name: 'Hex color' } ) ).not.toHaveValue( value );
	} );

	it( 'returns focus on Escape without closing the containing dialog', async () => {
		const onOpenChange = vi.fn();
		const { user } = renderWithProviders(
			<Dialog open onOpenChange={ onOpenChange }>
				<DialogContent>
					<DialogTitle>Settings</DialogTitle>
					<PickerExample />
				</DialogContent>
			</Dialog>
		);
		const input = await screen.findByRole( 'textbox', { name: 'Hex color' } );
		await user.click( input );
		await user.tab();
		await user.keyboard( '{Escape}' );
		await waitFor( () =>
			expect( screen.queryByRole( 'dialog', { name: 'Color picker' } ) ).not.toBeInTheDocument()
		);
		expect( input ).toHaveFocus();
		expect( onOpenChange ).not.toHaveBeenCalled();
		await user.keyboard( '{Enter}' );
		expect( await screen.findByRole( 'dialog', { name: 'Color picker' } ) ).toBeVisible();
	} );
} );
