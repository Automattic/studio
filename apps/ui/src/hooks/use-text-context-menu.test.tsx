import { fireEvent, render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { watchComposerTextQuote } from '@/lib/composer-text-quote';
import {
	CODE_TEXT_ATTRIBUTE,
	MESSAGE_TEXT_ATTRIBUTE,
	QUOTABLE_TEXT_ATTRIBUTE,
	useTextContextMenu,
} from './use-text-context-menu';

const showTextContextMenu = vi.fn().mockResolvedValue( undefined );

vi.mock( '@/data/core', () => ( {
	useConnector: () => ( { showTextContextMenu } ),
} ) );

function Harness() {
	useTextContextMenu();
	return (
		<div>
			<div
				data-testid="message"
				{ ...{
					[ MESSAGE_TEXT_ATTRIBUTE ]: 'The whole reply.',
					[ QUOTABLE_TEXT_ATTRIBUTE ]: true,
				} }
			>
				<p data-testid="message-paragraph">The whole reply.</p>
				<div { ...{ [ CODE_TEXT_ATTRIBUTE ]: 'const answer = 42;' } }>
					<pre data-testid="message-code">const answer = 42;</pre>
				</div>
			</div>
			<div data-testid="user-message" { ...{ [ MESSAGE_TEXT_ATTRIBUTE ]: 'My question.' } }>
				My question.
			</div>
			<pre data-testid="tool-output">wp plugin list</pre>
			<input data-testid="field" />
			<input data-testid="readonly-field" readOnly />
			<input data-testid="checkbox" type="checkbox" />
			<div data-testid="editable" contentEditable />
			<button data-testid="menu-item">Settings</button>
		</div>
	);
}

/** Stubs a selection that intersects only the given node. */
function selectWithin( selected: Node | null, text = 'whole' ) {
	vi.spyOn( window, 'getSelection' ).mockReturnValue( {
		isCollapsed: selected === null,
		rangeCount: selected === null ? 0 : 1,
		getRangeAt: () => ( { intersectsNode: ( node: Node ) => node === selected } ),
		toString: () => text,
	} as unknown as Selection );
}

describe( 'useTextContextMenu', () => {
	beforeEach( () => {
		vi.restoreAllMocks();
		showTextContextMenu.mockReset().mockResolvedValue( undefined );
		selectWithin( null );
	} );

	it( 'offers the whole message when right-clicking inside one', () => {
		const { getByTestId } = render( <Harness /> );

		fireEvent.contextMenu( getByTestId( 'message-paragraph' ) );

		expect( showTextContextMenu ).toHaveBeenCalledWith( {
			selectionText: '',
			isEditable: false,
			messageText: 'The whole reply.',
		} );
	} );

	it( 'stays out of the way on non-text UI like menus and buttons', () => {
		const { getByTestId } = render( <Harness /> );

		fireEvent.contextMenu( getByTestId( 'menu-item' ) );

		expect( showTextContextMenu ).not.toHaveBeenCalled();
	} );

	it( 'reports the code block and whole message when right-clicking rendered code', () => {
		const { getByTestId } = render( <Harness /> );

		fireEvent.contextMenu( getByTestId( 'message-code' ) );

		expect( showTextContextMenu ).toHaveBeenCalledWith( {
			selectionText: '',
			isEditable: false,
			messageText: 'The whole reply.',
			codeText: 'const answer = 42;',
		} );
	} );

	it( 'ignores a selection left behind somewhere else in the app', () => {
		const { getByTestId } = render( <Harness /> );
		selectWithin( getByTestId( 'message-paragraph' ) );

		fireEvent.contextMenu( getByTestId( 'menu-item' ) );

		expect( showTextContextMenu ).not.toHaveBeenCalled();
	} );

	it( 'offers Copy for a selection the pointer is inside, even outside a message', () => {
		const { getByTestId } = render( <Harness /> );
		const toolOutput = getByTestId( 'tool-output' );
		selectWithin( toolOutput, 'wp plugin list' );

		fireEvent.contextMenu( toolOutput );

		expect( showTextContextMenu ).toHaveBeenCalledWith( {
			selectionText: 'wp plugin list',
			isEditable: false,
			messageText: undefined,
		} );
	} );

	it( 'only offers quoting for a selection inside an assistant message', () => {
		const { getByTestId } = render( <Harness /> );
		const messageParagraph = getByTestId( 'message-paragraph' );
		selectWithin( messageParagraph, 'The whole reply.' );

		fireEvent.contextMenu( messageParagraph );

		expect( showTextContextMenu ).toHaveBeenCalledWith( {
			selectionText: 'The whole reply.',
			isEditable: false,
			messageText: 'The whole reply.',
			canQuoteSelection: true,
		} );
	} );

	it( 'does not offer quoting for a selection inside a user message', () => {
		const { getByTestId } = render( <Harness /> );
		const userMessage = getByTestId( 'user-message' );
		selectWithin( userMessage, 'My question.' );

		fireEvent.contextMenu( userMessage );

		expect( showTextContextMenu ).toHaveBeenCalledWith( {
			selectionText: 'My question.',
			isEditable: false,
			messageText: 'My question.',
		} );
	} );

	it( 'reports an editable field so the host can offer Paste', () => {
		const { getByTestId } = render( <Harness /> );

		fireEvent.contextMenu( getByTestId( 'field' ) );

		expect( showTextContextMenu ).toHaveBeenCalledWith( {
			selectionText: '',
			isEditable: true,
			messageText: undefined,
		} );
	} );

	it( 'reports a contenteditable region so the host can offer Paste', () => {
		const { getByTestId } = render( <Harness /> );

		fireEvent.contextMenu( getByTestId( 'editable' ) );

		expect( showTextContextMenu ).toHaveBeenCalledWith( {
			selectionText: '',
			isEditable: true,
			messageText: undefined,
		} );
	} );

	it( 'reports selected text inside an editable field so the host can offer Copy', () => {
		const { getByTestId } = render( <Harness /> );
		const field = getByTestId( 'field' ) as HTMLInputElement;
		field.value = 'Copy this text';
		field.setSelectionRange( 5, 9 );

		fireEvent.contextMenu( field );

		expect( showTextContextMenu ).toHaveBeenCalledWith( {
			selectionText: 'this',
			isEditable: true,
			messageText: undefined,
		} );
	} );

	it( 'allows Copy but not Paste for selected text in a read-only field', () => {
		const { getByTestId } = render( <Harness /> );
		const field = getByTestId( 'readonly-field' ) as HTMLInputElement;
		field.value = 'Read-only text';
		field.setSelectionRange( 0, 9 );

		fireEvent.contextMenu( field );

		expect( showTextContextMenu ).toHaveBeenCalledWith( {
			selectionText: 'Read-only',
			isEditable: false,
			messageText: undefined,
		} );
	} );

	it( 'stays out of the way on non-text inputs', () => {
		const { getByTestId } = render( <Harness /> );

		fireEvent.contextMenu( getByTestId( 'checkbox' ) );

		expect( showTextContextMenu ).not.toHaveBeenCalled();
	} );

	it( 'routes a native Quote action back to the composer', async () => {
		const quoteListener = vi.fn();
		const stopWatching = watchComposerTextQuote( quoteListener );
		showTextContextMenu.mockResolvedValueOnce( {
			action: 'quote-selection',
			selectionText: 'The selected reply.',
		} );
		const { getByTestId } = render( <Harness /> );
		const messageParagraph = getByTestId( 'message-paragraph' );
		selectWithin( messageParagraph, 'The selected reply.' );

		fireEvent.contextMenu( messageParagraph );

		await waitFor( () => expect( quoteListener ).toHaveBeenCalledWith( 'The selected reply.' ) );
		stopWatching();
	} );
} );
