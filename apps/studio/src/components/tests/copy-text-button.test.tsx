// To run tests, execute `npm run test -- src/components/copy-text-button.test.ts` from the root directory
import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { vi } from 'vitest';
import { CopyTextButton } from 'src/components/copy-text-button';

const mockCopyText = vi.fn();

vi.mock( 'src/lib/get-ipc-api', () => ( {
	getIpcApi: () => ( {
		copyText: mockCopyText,
	} ),
} ) );

describe( 'CopyTextButton', () => {
	beforeEach( () => {
		mockCopyText.mockClear();
	} );

	test( 'the button is present, and not the confirmation', () => {
		render( <CopyTextButton text="Sample Text" copyConfirmation="Copied!" /> );
		expect( screen.getByRole( 'button', { name: 'Copy to clipboard' } ) ).toBeVisible();
		expect( screen.queryByRole( 'alert' ) ).not.toBeInTheDocument();
	} );

	test( 'the confirmation is present after click', async () => {
		const user = userEvent.setup();

		render( <CopyTextButton text="Sample Text" copyConfirmation="Copied!" /> );
		expect( screen.getByRole( 'button', { name: 'Copy to clipboard' } ) ).toBeVisible();
		await user.click( screen.getByRole( 'button' ) );
		expect( screen.getByRole( 'alert' ) ).toHaveTextContent( 'Copied!' );
		expect( mockCopyText ).toHaveBeenCalledWith( 'Sample Text' );
	} );
} );
