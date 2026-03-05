// To run tests, execute `npm run test -- src/components/tests/password-control.test.tsx` from the root directory
import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import PasswordControl from 'src/components/password-control';

describe( 'PasswordControl', () => {
	test( 'renders password input with hidden text by default', () => {
		render( <PasswordControl value="secret123" onChange={ () => {} } /> );
		const input = screen.getByDisplayValue( 'secret123' );
		expect( input ).toHaveAttribute( 'type', 'password' );
	} );

	test( 'toggles password visibility when button is clicked', async () => {
		const user = userEvent.setup();
		render( <PasswordControl value="secret123" onChange={ () => {} } /> );

		const input = screen.getByDisplayValue( 'secret123' );
		const toggleButton = screen.getByRole( 'button', { name: 'Show password' } );

		expect( input ).toHaveAttribute( 'type', 'password' );

		await user.click( toggleButton );
		expect( input ).toHaveAttribute( 'type', 'text' );
		expect( screen.getByRole( 'button', { name: 'Hide password' } ) ).toBeVisible();

		await user.click( toggleButton );
		expect( input ).toHaveAttribute( 'type', 'password' );
	} );

	test( 'calls onChange when input value changes', async () => {
		const handleChange = vi.fn();
		const user = userEvent.setup();
		render( <PasswordControl id="test-password" value="" onChange={ handleChange } /> );

		const input = document.getElementById( 'test-password' ) as HTMLInputElement;
		await user.type( input, 'newpassword' );

		expect( handleChange ).toHaveBeenCalledTimes( 11 ); // One call per character
		expect( handleChange ).toHaveBeenLastCalledWith( 'd' );
	} );

	test( 'renders with custom id and placeholder', () => {
		render(
			<PasswordControl
				id="custom-password"
				value=""
				onChange={ () => {} }
				placeholder="Enter password"
			/>
		);

		const input = screen.getByPlaceholderText( 'Enter password' );
		expect( input ).toHaveAttribute( 'id', 'custom-password' );
	} );

	test( 'disables input and button when disabled prop is true', () => {
		render( <PasswordControl value="secret" onChange={ () => {} } disabled /> );

		const input = screen.getByDisplayValue( 'secret' );
		const toggleButton = screen.getByRole( 'button', { name: 'Show password' } );

		expect( input ).toBeDisabled();
		expect( toggleButton ).toBeDisabled();
	} );

	test( 'applies custom className', () => {
		const { container } = render(
			<PasswordControl value="" onChange={ () => {} } className="custom-class" />
		);

		expect( container.firstChild ).toHaveClass( 'custom-class' );
	} );
} );
