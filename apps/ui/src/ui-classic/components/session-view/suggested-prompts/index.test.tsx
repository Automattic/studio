import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SuggestedPrompts } from '.';

function renderPrompts( hasExistingDraft: () => boolean ) {
	const onPick = vi.fn();
	render(
		<SuggestedPrompts
			siteName="Test Site"
			onPick={ onPick }
			hasExistingDraft={ hasExistingDraft }
		/>
	);
	return { onPick };
}

describe( 'SuggestedPrompts', () => {
	it( 'picks straight through when the composer is empty', () => {
		const { onPick } = renderPrompts( () => false );
		fireEvent.click( screen.getAllByRole( 'button' )[ 0 ] );
		expect( onPick ).toHaveBeenCalledTimes( 1 );
		expect( onPick.mock.calls[ 0 ][ 0 ] ).toBeTruthy();
		expect( screen.queryByText( 'Replace your draft?' ) ).not.toBeInTheDocument();
	} );

	it( 'asks before replacing an existing draft', () => {
		const { onPick } = renderPrompts( () => true );
		fireEvent.click( screen.getAllByRole( 'button' )[ 0 ] );
		expect( onPick ).not.toHaveBeenCalled();
		expect( screen.getByText( 'Replace your draft?' ) ).toBeInTheDocument();

		fireEvent.click( screen.getByRole( 'button', { name: 'Use suggestion' } ) );
		expect( onPick ).toHaveBeenCalledTimes( 1 );
		expect( screen.queryByText( 'Replace your draft?' ) ).not.toBeInTheDocument();
	} );

	it( 'keeps the draft on cancel', () => {
		const { onPick } = renderPrompts( () => true );
		fireEvent.click( screen.getAllByRole( 'button' )[ 0 ] );
		fireEvent.click( screen.getByRole( 'button', { name: 'Cancel' } ) );
		expect( onPick ).not.toHaveBeenCalled();
		expect( screen.queryByText( 'Replace your draft?' ) ).not.toBeInTheDocument();
	} );
} );
