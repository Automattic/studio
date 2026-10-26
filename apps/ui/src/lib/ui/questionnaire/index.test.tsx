import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Questionnaire, QuestionnaireChoice, QuestionnaireChoices, QuestionnaireTitle } from '.';

function renderQuestion( {
	multiple = false,
	shortcuts = true,
	checked = '',
	disabled = false,
} = {} ) {
	const onSelect = vi.fn();
	render(
		<Questionnaire multiple={ multiple } shortcuts={ shortcuts }>
			<QuestionnaireTitle>Which layout?</QuestionnaireTitle>
			<QuestionnaireChoices>
				{ [ 'Grid', 'List' ].map( ( label, index ) => (
					<QuestionnaireChoice
						key={ label }
						label={ label }
						description={ `${ label } layout` }
						shortcut={ String.fromCharCode( 65 + index ) }
						checked={ checked === label }
						disabled={ disabled }
						onSelect={ () => onSelect( label ) }
					/>
				) ) }
			</QuestionnaireChoices>
		</Questionnaire>
	);
	return onSelect;
}

describe( 'Questionnaire', () => {
	it( 'is a group named by its question, with choices named by their labels', () => {
		renderQuestion();
		const group = screen.getByRole( 'group', { name: 'Which layout?' } );
		expect( group.tagName ).toBe( 'FIELDSET' );
		expect( screen.getByRole( 'radio', { name: 'Grid' } ) ).toHaveAccessibleDescription(
			'Grid layout'
		);
	} );

	it( 'answers with checkboxes when several choices can be picked', () => {
		const onSelect = renderQuestion( { multiple: true } );
		fireEvent.click( screen.getByRole( 'checkbox', { name: 'List' } ) );
		expect( onSelect ).toHaveBeenCalledWith( 'List' );
	} );

	it( 'picks a radio again when it is already checked', () => {
		const onSelect = renderQuestion( { checked: 'Grid' } );
		fireEvent.click( screen.getByText( 'Grid' ) );
		expect( onSelect ).toHaveBeenCalledWith( 'Grid' );
	} );

	it( 'picks the choice lettered like a key pressed inside it, without modifiers', () => {
		const onSelect = renderQuestion();
		const group = screen.getByRole( 'group' );
		fireEvent.keyDown( group, { key: 'b', metaKey: true } );
		expect( onSelect ).not.toHaveBeenCalled();
		fireEvent.keyDown( group, { key: 'b' } );
		expect( onSelect ).toHaveBeenCalledWith( 'List' );
	} );

	it.each( [ { shortcuts: false }, { disabled: true } ] )(
		'ignores letter keys with %o',
		( options ) => {
			const onSelect = renderQuestion( options );
			fireEvent.keyDown( screen.getByRole( 'group' ), { key: 'a' } );
			expect( onSelect ).not.toHaveBeenCalled();
		}
	);
} );
