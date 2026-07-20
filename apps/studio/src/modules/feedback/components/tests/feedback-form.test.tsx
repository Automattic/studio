// To run: npm run test -- src/modules/feedback/components/tests/feedback-form.test.tsx
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { getIpcApi } from 'src/lib/get-ipc-api';
import FeedbackForm from 'src/modules/feedback/components/feedback-form';

const submitFeedback = vi.fn();

vi.mock( 'src/lib/get-ipc-api', () => ( {
	getIpcApi: vi.fn(),
} ) );

beforeEach( () => {
	vi.clearAllMocks();
	submitFeedback.mockResolvedValue( { success: true } );
	vi.mocked( getIpcApi ).mockReturnValue( {
		submitFeedback,
		openApplicationLogs: vi.fn(),
	} as unknown as ReturnType< typeof getIpcApi > );
} );

describe( 'FeedbackForm', () => {
	it( 'renders with no providers (crash-screen mode)', () => {
		render( <FeedbackForm identity={ undefined } source="crash" /> );
		expect( screen.getByLabelText( 'Your feedback' ) ).toBeVisible();
	} );

	it( 'disables the submit button until a message is entered', async () => {
		render( <FeedbackForm identity={ undefined } /> );
		const submit = screen.getByRole( 'button', { name: 'Send feedback' } );
		expect( submit ).toHaveAttribute( 'aria-disabled', 'true' );

		await userEvent.type( screen.getByLabelText( 'Your feedback' ), 'Hello there' );
		expect( submit ).not.toHaveAttribute( 'aria-disabled', 'true' );
	} );

	it( 'shows the optional email field only when logged out', () => {
		const { rerender } = render( <FeedbackForm identity={ undefined } /> );
		expect( screen.getByLabelText( /Email/ ) ).toBeVisible();

		rerender( <FeedbackForm identity={ { isAuthenticated: true, email: 'me@example.com' } } /> );
		expect( screen.queryByLabelText( /Email/ ) ).not.toBeInTheDocument();
	} );

	it( 'defaults the include-logs checkbox to checked', () => {
		render( <FeedbackForm identity={ undefined } /> );
		expect(
			screen.getByRole( 'checkbox', {
				name: 'Include recent app logs & diagnostics to help us debug',
			} )
		).toBeChecked();
	} );

	it( 'submits the entered feedback and calls onSubmitted on success', async () => {
		const onSubmitted = vi.fn();
		render( <FeedbackForm identity={ undefined } onSubmitted={ onSubmitted } /> );

		await userEvent.type( screen.getByLabelText( 'Your feedback' ), 'Nice work' );
		await userEvent.type( screen.getByLabelText( /Email/ ), 'reply@example.com' );
		await userEvent.click( screen.getByRole( 'button', { name: 'Send feedback' } ) );

		await waitFor( () => {
			expect( submitFeedback ).toHaveBeenCalledWith( {
				message: 'Nice work',
				email: 'reply@example.com',
				includeLogs: true,
				category: 'general',
			} );
		} );
		expect( onSubmitted ).toHaveBeenCalled();
		expect( screen.getByText( 'Thanks for your feedback!' ) ).toBeVisible();
	} );

	it( 'keeps the form open and shows an error when submission fails', async () => {
		submitFeedback.mockResolvedValue( { success: false, error: 'network' } );
		render( <FeedbackForm identity={ undefined } /> );

		await userEvent.type( screen.getByLabelText( 'Your feedback' ), 'Broken' );
		await userEvent.click( screen.getByRole( 'button', { name: 'Send feedback' } ) );

		expect( await screen.findByRole( 'alert' ) ).toHaveTextContent(
			"Couldn't send feedback. Check your connection and try again."
		);
		expect( screen.getByLabelText( 'Your feedback' ) ).toBeVisible();
	} );
} );
