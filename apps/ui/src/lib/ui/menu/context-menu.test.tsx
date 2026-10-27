import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import * as Menu from './index';

describe( 'keyboard context menus', () => {
	it( 'opens from the keyboard context menu event and restores focus on Escape', async () => {
		render(
			<Menu.ContextMenuRoot>
				<Menu.ContextMenuTrigger render={ <button type="button" /> }>Chat</Menu.ContextMenuTrigger>
				<Menu.ContextPopup>
					<Menu.Item>Rename</Menu.Item>
					<Menu.Item>Archive</Menu.Item>
				</Menu.ContextPopup>
			</Menu.ContextMenuRoot>
		);
		const trigger = screen.getByRole( 'button', { name: 'Chat' } );
		trigger.focus();
		fireEvent.contextMenu( trigger );
		const item = await screen.findByRole( 'menuitem', { name: 'Rename' } );
		expect( item ).toBeVisible();
		fireEvent.keyDown( item, { key: 'Escape' } );
		await waitFor( () => expect( trigger ).toHaveFocus() );
	} );
} );
