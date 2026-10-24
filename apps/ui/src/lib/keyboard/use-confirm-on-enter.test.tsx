import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useConfirmOnEnter } from './use-confirm-on-enter';

const onConfirm = vi.fn();
const onCancel = vi.fn();

function Dialog( { confirmDisabled = false }: { confirmDisabled?: boolean } ) {
	const handleKeyDown = useConfirmOnEnter( 'Delete site' );
	return (
		// Stands in for the dialog popup, which owns its own keyboard handling.
		<div role="alertdialog" onKeyDown={ handleKeyDown }>
			<input type="checkbox" aria-label="Delete site files" />
			<input type="text" aria-label="Notes" />
			<button type="button" onClick={ onCancel }>
				Cancel
			</button>
			<button
				type="button"
				aria-disabled={ confirmDisabled }
				onClick={ () => ! confirmDisabled && onConfirm() }
			>
				Delete site
			</button>
		</div>
	);
}

describe( 'useConfirmOnEnter', () => {
	beforeEach( () => {
		vi.clearAllMocks();
	} );

	it( 'confirms on Enter from a checkbox inside the dialog', () => {
		render( <Dialog /> );
		fireEvent.keyDown( screen.getByLabelText( 'Delete site files' ), { key: 'Enter' } );
		expect( onConfirm ).toHaveBeenCalledTimes( 1 );
	} );

	it( 'ignores an auto-repeating Enter, so a held key cannot confirm', () => {
		render( <Dialog /> );
		fireEvent.keyDown( screen.getByLabelText( 'Delete site files' ), {
			key: 'Enter',
			repeat: true,
		} );
		expect( onConfirm ).not.toHaveBeenCalled();
	} );

	it( 'leaves Enter to buttons, so Cancel does not also confirm', () => {
		render( <Dialog /> );
		fireEvent.keyDown( screen.getByRole( 'button', { name: 'Cancel' } ), { key: 'Enter' } );
		expect( onConfirm ).not.toHaveBeenCalled();
	} );

	it( 'leaves Enter to text fields', () => {
		render( <Dialog /> );
		fireEvent.keyDown( screen.getByLabelText( 'Notes' ), { key: 'Enter' } );
		expect( onConfirm ).not.toHaveBeenCalled();
	} );

	it( 'ignores Enter with a modifier held', () => {
		render( <Dialog /> );
		fireEvent.keyDown( screen.getByLabelText( 'Delete site files' ), {
			key: 'Enter',
			metaKey: true,
		} );
		expect( onConfirm ).not.toHaveBeenCalled();
	} );

	it( 'does nothing while the confirm button is disabled', () => {
		render( <Dialog confirmDisabled /> );
		fireEvent.keyDown( screen.getByLabelText( 'Delete site files' ), { key: 'Enter' } );
		expect( onConfirm ).not.toHaveBeenCalled();
	} );

	it( 'ignores other keys', () => {
		render( <Dialog /> );
		fireEvent.keyDown( screen.getByLabelText( 'Delete site files' ), { key: ' ' } );
		expect( onConfirm ).not.toHaveBeenCalled();
	} );
} );
