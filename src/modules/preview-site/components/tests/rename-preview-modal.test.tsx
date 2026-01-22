import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, beforeEach, describe, it, expect } from 'vitest';
import { RenamePreviewModal } from '../rename-preview-modal';

describe( 'RenamePreviewModal', () => {
	const mockOnRename = vi.fn();
	const mockOnClose = vi.fn();
	const initialName = 'Initial Preview Name';

	beforeEach( () => {
		vi.clearAllMocks();
	} );

	it( 'renders with initial name in input', () => {
		render(
			<RenamePreviewModal
				initialName={ initialName }
				onRename={ mockOnRename }
				onClose={ mockOnClose }
			/>
		);

		expect( screen.getByRole( 'textbox' ) ).toHaveValue( initialName );
		expect( screen.getByRole( 'button', { name: 'Save' } ) ).toBeDisabled();
	} );

	it( 'calls onClose when cancel button is clicked', async () => {
		const user = userEvent.setup();
		render(
			<RenamePreviewModal
				initialName={ initialName }
				onRename={ mockOnRename }
				onClose={ mockOnClose }
			/>
		);

		await user.click( screen.getByRole( 'button', { name: 'Cancel' } ) );
		expect( mockOnClose ).toHaveBeenCalledTimes( 1 );
		expect( mockOnRename ).not.toHaveBeenCalled();
	} );

	it( 'enables save button when name is changed', async () => {
		const user = userEvent.setup();
		render(
			<RenamePreviewModal
				initialName={ initialName }
				onRename={ mockOnRename }
				onClose={ mockOnClose }
			/>
		);

		const saveButton = screen.getByRole( 'button', { name: 'Save' } );
		expect( saveButton ).toBeDisabled();

		const input = screen.getByRole( 'textbox' );
		await user.clear( input );
		await user.type( input, 'New Preview Name' );

		expect( saveButton ).toBeEnabled();
	} );

	it( 'calls onRename with trimmed name when save button is clicked', async () => {
		const user = userEvent.setup();
		render(
			<RenamePreviewModal
				initialName={ initialName }
				onRename={ mockOnRename }
				onClose={ mockOnClose }
			/>
		);

		const input = screen.getByRole( 'textbox' );
		await user.clear( input );
		await user.type( input, '  New Preview Name  ' );

		await user.click( screen.getByRole( 'button', { name: 'Save' } ) );
		expect( mockOnRename ).toHaveBeenCalledWith( 'New Preview Name' );
	} );

	it( 'keeps save button disabled when input is empty or whitespace', async () => {
		const user = userEvent.setup();
		render(
			<RenamePreviewModal
				initialName={ initialName }
				onRename={ mockOnRename }
				onClose={ mockOnClose }
			/>
		);

		const saveButton = screen.getByRole( 'button', { name: 'Save' } );
		const input = screen.getByRole( 'textbox' );

		await user.clear( input );
		expect( saveButton ).toBeDisabled();

		await user.type( input, '   ' );
		expect( saveButton ).toBeDisabled();
	} );

	it( 'calls onRename when form is submitted when pressing Enter', async () => {
		const user = userEvent.setup();
		render(
			<RenamePreviewModal
				initialName={ initialName }
				onRename={ mockOnRename }
				onClose={ mockOnClose }
			/>
		);

		const input = screen.getByRole( 'textbox' );
		await user.clear( input );
		await user.type( input, 'New Preview Name{Enter}' );

		expect( mockOnRename ).toHaveBeenCalledWith( 'New Preview Name' );
	} );
} );
