import { fireEvent, render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { watchComposerTextQuote } from '@/lib/composer-text-quote';
import { MESSAGE_TEXT_ATTRIBUTE, useTextContextMenu } from './use-text-context-menu';

const showTextContextMenu = vi.fn().mockResolvedValue( undefined );

vi.mock( '@/data/core', () => ( {
	useConnector: () => ( { showTextContextMenu } ),
} ) );

function Harness() {
	useTextContextMenu();
	return (
		<div>
			<div data-testid="message" { ...{ [ MESSAGE_TEXT_ATTRIBUTE ]: 'The whole reply.' } }>
				<p data-testid="message-paragraph">The whole reply.</p>
			</div>
			<pre data-testid="tool-output">wp plugin list</pre>
			<input data-testid="field" />
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

	it( 'reports an editable field so the host can offer Paste', () => {
		const { getByTestId } = render( <Harness /> );

		fireEvent.contextMenu( getByTestId( 'field' ) );

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

	it( 'routes a native Quote action back to the composer', async () => {
		const quoteListener = vi.fn();
		const stopWatching = watchComposerTextQuote( quoteListener );
		showTextContextMenu.mockResolvedValueOnce( {
			action: 'quote-selection',
			selectionText: 'The selected reply.',
		} );
		const { getByTestId } = render( <Harness /> );
		const toolOutput = getByTestId( 'tool-output' );
		selectWithin( toolOutput, 'The selected reply.' );

		fireEvent.contextMenu( toolOutput );

		await waitFor( () => expect( quoteListener ).toHaveBeenCalledWith( 'The selected reply.' ) );
		stopWatching();
	} );
} );
