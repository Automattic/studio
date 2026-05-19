import { describe, expect, it } from 'vitest';
import { CHAT_PANEL_LIST_WIDTH, getChatPanelShift } from '@/ui-desks/chats/use-chat-panel-resize';

describe( 'getChatPanelShift', () => {
	it( 'does not shift the toolbar when the chat panel is closed', () => {
		expect(
			getChatPanelShift( {
				open: false,
				expanded: true,
				side: 'right',
				width: 760,
			} )
		).toBe( 0 );
	} );

	it( 'centers around a left-side list-only chat panel', () => {
		expect(
			getChatPanelShift( {
				open: true,
				expanded: false,
				side: 'left',
				width: 760,
			} )
		).toBe( CHAT_PANEL_LIST_WIDTH / 2 );
	} );

	it( 'centers around a right-side expanded chat panel', () => {
		expect(
			getChatPanelShift( {
				open: true,
				expanded: true,
				side: 'right',
				width: 640,
			} )
		).toBe( -320 );
	} );
} );
