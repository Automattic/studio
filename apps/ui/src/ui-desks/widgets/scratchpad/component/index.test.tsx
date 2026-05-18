import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ScratchpadWidgetComponent } from './index';

const chatMocks = vi.hoisted( () => ( {
	startChatWithPrompt: vi.fn(),
	onAgentEvent: vi.fn(),
} ) );

vi.mock( '@wordpress/i18n', () => ( {
	__: ( text: string ) => text,
	sprintf: ( text: string, value: string ) => text.replace( '%s', value ),
} ) );

vi.mock( '@wordpress/icons', () => ( {
	blockDefault: {},
	check: {},
	cog: {},
	page: {},
	redo: {},
	reusableBlock: {},
} ) );

vi.mock( '@wordpress/ui', () => ( {
	Icon: () => null,
} ) );

vi.mock( 'tldraw', () => ( {
	useEditor: () => ( {} ),
} ) );

vi.mock( '@/data/core', () => ( {
	useConnector: () => ( {
		onAgentEvent: chatMocks.onAgentEvent,
	} ),
} ) );

vi.mock( '@/ui-desks/chats/context', () => ( {
	useChats: () => ( {
		startChatWithPrompt: chatMocks.startChatWithPrompt,
	} ),
} ) );

vi.mock( '@/ui-desks/connectors/context', () => ( {
	focusOnDeskShape: vi.fn(),
	useIncomingWidgetConnections: () => [],
} ) );

describe( 'ScratchpadWidgetComponent', () => {
	beforeEach( () => {
		chatMocks.startChatWithPrompt.mockReset().mockResolvedValue( 'session-1' );
		chatMocks.onAgentEvent.mockReset().mockReturnValue( () => {} );
	} );

	it( 'starts a chat agent run from a pending scratchpad', async () => {
		const onWidgetPropsChange = vi.fn();

		render(
			<ScratchpadWidgetComponent
				id="scratchpad-1"
				widgetProps={ {
					html: '<main><h1>Draft</h1></main>',
					title: 'Landing page draft',
					scope: 'page',
					description: 'Tighten the hero.',
					agentStatus: 'pending',
				} }
				isEditing={ false }
				isHovered={ false }
				isSelected={ false }
				onWidgetPropsChange={ onWidgetPropsChange }
				onEditComplete={ vi.fn() }
			/>
		);

		fireEvent.click( screen.getByRole( 'button', { name: 'Run agent on this' } ) );

		await waitFor( () => {
			expect( chatMocks.startChatWithPrompt ).toHaveBeenCalledTimes( 1 );
		} );
		expect( chatMocks.startChatWithPrompt ).toHaveBeenCalledWith(
			expect.objectContaining( {
				displayMessage: 'Run agent on scratchpad: Landing page draft\n\nTighten the hero.',
				prompt: expect.stringContaining( 'call studio_present with exactly one scratchpad widget' ),
			} )
		);
		expect( onWidgetPropsChange ).toHaveBeenCalledWith(
			expect.objectContaining( {
				agentStatus: 'running',
			} )
		);
		expect( onWidgetPropsChange ).toHaveBeenLastCalledWith(
			expect.objectContaining( {
				agentStatus: 'running',
				agentSessionId: 'session-1',
			} )
		);
	} );
} );
