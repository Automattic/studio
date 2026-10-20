import { fireEvent, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useNewChatShortcut } from './session-chat-actions';

describe( 'useNewChatShortcut', () => {
	it( 'starts a new chat on the primary modifier + N, only while enabled', () => {
		const onNewChat = vi.fn();
		const { rerender } = renderHook( ( { enabled } ) => useNewChatShortcut( onNewChat, enabled ), {
			initialProps: { enabled: true },
		} );

		fireEvent.keyDown( document, { key: 'n', ctrlKey: true } );
		rerender( { enabled: false } );
		fireEvent.keyDown( document, { key: 'n', ctrlKey: true } );

		expect( onNewChat ).toHaveBeenCalledTimes( 1 );
	} );
} );
