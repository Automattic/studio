import { render, screen, fireEvent } from '@testing-library/react';
import { TerminalPicker } from 'src/components/terminal-picker';

describe( 'TerminalPicker', () => {
	const mockOnChange = jest.fn();

	beforeEach( () => {
		jest.clearAllMocks();
	} );

	it( 'renders correctly with initial props', () => {
		render( <TerminalPicker value="terminal" onChange={ mockOnChange } /> );

		expect( screen.getByText( 'Shell' ) ).toBeVisible();
		expect( screen.getByRole( 'combobox' ) ).toBeVisible();
	} );

	it( 'calls onChange when selecting a different terminal', async () => {
		render( <TerminalPicker value="terminal" onChange={ mockOnChange } /> );

		const select = screen.getByRole( 'combobox' );
		fireEvent.change( select, { target: { value: 'iterm' } } );

		expect( mockOnChange ).toHaveBeenCalledWith( 'iterm', expect.anything() );
	} );
} );
