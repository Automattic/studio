// To run tests, execute `npm run test -- src/components/copy-text-button.test.ts` from the root directory
import { render, fireEvent } from '@testing-library/react';
import { getIpcApi } from '../lib/get-ipc-api';
import { CopyTextButton } from './copy-text-button';

jest.mock( '../lib/get-ipc-api' );

describe( 'CopyTextButton', () => {
	const mockCopyText = jest.fn();
	beforeEach( () => {
		jest.mock( '../lib/get-ipc-api', () => ( {
			getIpcApi: () => ( {
				copyText: mockCopyText,
			} ),
		} ) );
	} );

	test( 'the button is present, and not the confirmation', () => {
		const { getByRole, queryByText } = render(
			<CopyTextButton text="Sample Text" copyConfirmation="Copied!" />
		);
		expect( getByRole( 'button', { name: 'copy to clipboard' } ) ).toBeInTheDocument();
		expect( queryByText( 'Copied!' ) ).toBe( null );
	} );

	test( 'the confirmation is present after click', () => {
		const mockCopyText = jest.fn();
		( getIpcApi as jest.Mock ).mockReturnValue( { copyText: mockCopyText } );
		const { getByRole, queryByText } = render(
			<CopyTextButton text="Sample Text" copyConfirmation="Copied!" />
		);
		expect( getByRole( 'button', { name: 'copy to clipboard' } ) ).toBeInTheDocument();
		fireEvent.click( getByRole( 'button' ) );
		expect( queryByText( 'Copied!' ) ).not.toBe( null );
		expect( mockCopyText ).toHaveBeenCalledWith( 'Sample Text' );
	} );
} );
