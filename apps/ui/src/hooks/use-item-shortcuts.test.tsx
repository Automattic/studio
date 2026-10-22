import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useItemShortcuts } from './use-item-shortcuts';

function Item( {
	name,
	active,
	handlers,
}: {
	name: string;
	active?: 'chat' | 'site';
	handlers: Parameters< typeof useItemShortcuts >[ 0 ];
} ) {
	return (
		<button { ...useItemShortcuts( handlers ) } data-item-shortcuts-active={ active }>
			{ name }
		</button>
	);
}

const handlers = () => ( { rename: vi.fn(), pin: vi.fn(), archive: vi.fn(), lifecycle: vi.fn() } );

function renderItems() {
	const row = handlers();
	const chat = handlers();
	const site = handlers();
	const view = render(
		<>
			<Item name="Row" handlers={ row } />
			<Item name="Open chat" active="chat" handlers={ chat } />
			<Item name="Current site" active="site" handlers={ site } />
			<input aria-label="Composer" />
		</>
	);
	return { row, chat, site, ...view };
}

const pin = { key: 'π', code: 'KeyP', ctrlKey: true, altKey: true };

describe( 'useItemShortcuts', () => {
	it( 'acts on the focused row, else the open chat, else the current site', () => {
		const { row, chat, site, rerender } = renderItems();

		fireEvent.keyDown( screen.getByRole( 'button', { name: 'Row' } ), pin );
		expect( row.pin ).toHaveBeenCalledTimes( 1 );
		fireEvent.keyDown( screen.getByRole( 'textbox', { name: 'Composer' } ), pin );
		expect( chat.pin ).toHaveBeenCalledTimes( 1 );

		rerender( <Item name="Current site" active="site" handlers={ site } /> );
		fireEvent.keyDown( document.body, { key: 'A', code: 'KeyA', ctrlKey: true, shiftKey: true } );
		fireEvent.keyDown( document.body, { key: '®', code: 'KeyR', ctrlKey: true, altKey: true } );
		expect( site.archive ).toHaveBeenCalledTimes( 1 );
		expect( site.rename ).toHaveBeenCalledTimes( 1 );
		expect( row.pin ).toHaveBeenCalledTimes( 1 );
	} );

	it( 'renames with F2 only what has focus, and starts or stops only the current site', () => {
		const { row, chat, site } = renderItems();

		fireEvent.keyDown( document.body, { key: 'F2' } );
		fireEvent.keyDown( screen.getByRole( 'button', { name: 'Row' } ), { key: 'F2' } );
		fireEvent.keyDown( screen.getByRole( 'button', { name: 'Row' } ), {
			key: 'ß',
			code: 'KeyS',
			ctrlKey: true,
			altKey: true,
		} );

		expect( row.rename ).toHaveBeenCalledTimes( 1 );
		expect( chat.rename ).not.toHaveBeenCalled();
		expect( site.lifecycle ).toHaveBeenCalledTimes( 1 );
		expect( row.lifecycle ).not.toHaveBeenCalled();
		expect( chat.lifecycle ).not.toHaveBeenCalled();
	} );

	it( 'leaves the keys to dialogs', () => {
		const { chat } = renderItems();
		render(
			<div role="dialog">
				<input aria-label="Name" />
			</div>
		);
		fireEvent.keyDown( screen.getByRole( 'textbox', { name: 'Name' } ), pin );
		expect( chat.pin ).not.toHaveBeenCalled();
	} );
} );
