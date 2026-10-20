import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { NewChatButton } from './session-chat-actions';

describe( 'NewChatButton', () => {
	it( 'starts a new chat from the button and its keyboard shortcut', () => {
		const onNewChat = vi.fn();
		render( <NewChatButton onNewChat={ onNewChat } /> );

		const button = screen.getByRole( 'button', { name: 'New chat' } );
		fireEvent.click( button );
		const shortcut = button.getAttribute( 'aria-keyshortcuts' );
		fireEvent.keyDown( document, {
			key: 'n',
			ctrlKey: shortcut?.startsWith( 'Control+' ),
			metaKey: shortcut?.startsWith( 'Meta+' ),
		} );

		expect( onNewChat ).toHaveBeenCalledTimes( 2 );
	} );
} );
