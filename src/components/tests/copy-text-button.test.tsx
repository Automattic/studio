// To run tests, execute `npm run test -- src/components/copy-text-button.test.ts` from the root directory
import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { getIpcApi } from '../../lib/get-ipc-api';
import { CopyTextButton } from '../copy-text-button';

jest.mock( '../../lib/get-ipc-api' );

describe( 'CopyTextButton', () => {
	const mockCopyText = jest.fn();
	beforeEach( () => {
		jest.mock( '../../lib/get-ipc-api', () => ( {
			getIpcApi: () => ( {
				copyText: mockCopyText,
			} ),
		} ) );
	} );

	test( 'the button is present, and not the confirmation', () => {
		render( <CopyTextButton text="Sample Text" copyConfirmation="Copied!" /> );
		expect( screen.getByRole( 'button', { name: 'copy to clipboard' } ) ).toBeInTheDocument();
		expect( screen.queryByRole( 'alert' ) ).toBe( null );
	} );

	test( 'the confirmation is present after click', async () => {
		const user = userEvent.setup();
		const mockCopyText = jest.fn();
		( getIpcApi as jest.Mock ).mockReturnValue( { copyText: mockCopyText } );
		render( <CopyTextButton text="Sample Text" copyConfirmation="Copied!" /> );
		expect( screen.getByRole( 'button', { name: 'copy to clipboard' } ) ).toBeInTheDocument();
		await user.click( screen.getByRole( 'button' ) );
		expect( screen.getByRole( 'alert' ) ).toHaveTextContent( 'Copied!' );
		expect( mockCopyText ).toHaveBeenCalledWith( 'Sample Text' );
	} );

	test( 'should prevent copying empty values', () => {
		const mockCopyText = jest.fn();
		( getIpcApi as jest.Mock ).mockReturnValue( { copyText: mockCopyText } );
		render( <CopyTextButton text="" copyConfirmation="Copied!" /> );
		expect( screen.getByRole( 'button', { name: 'copy to clipboard' } ) ).toBeDisabled();
	} );
} );
