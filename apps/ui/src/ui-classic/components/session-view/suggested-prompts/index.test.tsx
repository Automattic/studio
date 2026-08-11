import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Tooltip } from '@wordpress/ui';
import { describe, expect, it, vi } from 'vitest';
import { SuggestedPrompts } from '.';

function renderPrompts( initialDraft = { text: '', hasAttachments: false } ) {
	// Mirrors the composer: onPick replaces the draft with the picked prompt.
	const draft = { ...initialDraft };
	const onPick = vi.fn( ( prompt: string ) => {
		draft.text = prompt;
		draft.hasAttachments = false;
	} );
	render(
		<Tooltip.Provider delay={ 0 }>
			<div data-session-composer />
			<SuggestedPrompts siteName="Test Site" onPick={ onPick } getDraft={ () => draft } />
		</Tooltip.Provider>
	);
	return { onPick, draft };
}

function pickSuggestion( index: number ) {
	fireEvent.click( screen.getAllByRole( 'listitem' )[ index ].querySelector( 'button' )! );
}

describe( 'SuggestedPrompts', () => {
	it( 'picks straight through when the composer is empty', () => {
		const { onPick } = renderPrompts();
		pickSuggestion( 0 );
		expect( onPick ).toHaveBeenCalledTimes( 1 );
		expect( onPick.mock.calls[ 0 ][ 0 ] ).toBeTruthy();
		expect( screen.queryByText( 'Replace your draft?' ) ).not.toBeInTheDocument();
	} );

	it( 'animates the picked suggestion toward the composer', () => {
		renderPrompts();
		pickSuggestion( 0 );

		const transfer = screen.getByTestId( 'prompt-transfer' );
		expect( transfer ).toBeInTheDocument();
		fireEvent.animationEnd( transfer );
		expect( screen.queryByTestId( 'prompt-transfer' ) ).not.toBeInTheDocument();
	} );

	it( 'varies suggestion explanations without calling them prompts', async () => {
		renderPrompts();
		const user = userEvent.setup();
		const suggestions = screen.getAllByRole( 'listitem' );
		const tooltipLabels = [
			'Start with this idea',
			'Try this one',
			'Maybe this one',
			'Give this a go',
			'How about this',
			'Build from here',
			'Take this for a spin',
		];

		for ( const [ index, label ] of tooltipLabels.entries() ) {
			const button = suggestions[ index ].querySelector( 'button' )!;
			await user.hover( button );
			expect( await screen.findByText( label ) ).toBeVisible();
			await user.unhover( button );
		}
	} );

	it( 'replaces an untouched suggestion without asking', () => {
		const { onPick } = renderPrompts();
		pickSuggestion( 0 );
		pickSuggestion( 1 );
		expect( onPick ).toHaveBeenCalledTimes( 2 );
		expect( screen.queryByText( 'Replace your draft?' ) ).not.toBeInTheDocument();
	} );

	it( 'asks before replacing a user-written draft', () => {
		const { onPick } = renderPrompts( { text: 'my own words', hasAttachments: false } );
		pickSuggestion( 0 );
		expect( onPick ).not.toHaveBeenCalled();
		expect( screen.getByText( 'Replace your draft?' ) ).toBeInTheDocument();

		fireEvent.click( screen.getByRole( 'button', { name: 'Replace draft' } ) );
		expect( onPick ).toHaveBeenCalledTimes( 1 );
		expect( screen.queryByText( 'Replace your draft?' ) ).not.toBeInTheDocument();
	} );

	it( 'asks again once the user edits the inserted suggestion', () => {
		const { onPick, draft } = renderPrompts();
		pickSuggestion( 0 );
		draft.text += ' plus my edits';
		pickSuggestion( 1 );
		expect( onPick ).toHaveBeenCalledTimes( 1 );
		expect( screen.getByText( 'Replace your draft?' ) ).toBeInTheDocument();
	} );

	it( 'asks when attachments were added after inserting a suggestion', () => {
		const { onPick, draft } = renderPrompts();
		pickSuggestion( 0 );
		draft.hasAttachments = true;
		pickSuggestion( 1 );
		expect( onPick ).toHaveBeenCalledTimes( 1 );
		expect( screen.getByText( 'Replace your draft?' ) ).toBeInTheDocument();
	} );

	it( 'resets the baseline after a confirmed replacement', () => {
		const { onPick, draft } = renderPrompts();
		pickSuggestion( 0 );
		draft.text = 'edited by hand';
		pickSuggestion( 1 );
		fireEvent.click( screen.getByRole( 'button', { name: 'Replace draft' } ) );
		expect( onPick ).toHaveBeenCalledTimes( 2 );

		// The confirmed suggestion is the new baseline: picking another one
		// goes straight through again.
		pickSuggestion( 2 );
		expect( onPick ).toHaveBeenCalledTimes( 3 );
		expect( screen.queryByText( 'Replace your draft?' ) ).not.toBeInTheDocument();
	} );

	it( 'keeps the draft on cancel', () => {
		const { onPick } = renderPrompts( { text: 'my own words', hasAttachments: false } );
		pickSuggestion( 0 );
		fireEvent.click( screen.getByRole( 'button', { name: 'Cancel' } ) );
		expect( onPick ).not.toHaveBeenCalled();
		expect( screen.queryByText( 'Replace your draft?' ) ).not.toBeInTheDocument();
	} );
} );
