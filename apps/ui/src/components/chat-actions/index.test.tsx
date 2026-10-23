import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ChatContextMenu } from './index';
import type { AiSessionSummary } from '@/data/core';

vi.mock( '@tanstack/react-router', () => ( { useNavigate: () => vi.fn() } ) );
vi.mock( '@/data/queries/use-agent-run', () => ( {
	useSiteAgentActivity: () => undefined,
	useSessionsBusy: () => false,
} ) );
vi.mock( '@/data/queries/use-sessions', () => ( {
	useSessions: () => ( { data: [] } ),
	useUpdateSessionMetadata: () => ( { mutateAsync: vi.fn(), mutate: vi.fn() } ),
} ) );
vi.mock( '@/data/queries/use-sites', () => ( { useSites: () => ( { data: [] } ) } ) );
vi.mock( '@/data/queries/use-sidebar-pins', () => ( {
	chatPinKey: ( id: string ) => `chat:${ id }`,
	orderChats: ( chats: unknown[] ) => chats,
	useSidebarPins: () => ( { isPinned: () => false, togglePin: vi.fn() } ),
	useSidebarPreferences: () => ( { pins: [], chatOrder: {} } ),
} ) );

const session = { id: 'chat-1', title: 'Make it blue' } as AiSessionSummary;

function renderPane( chat?: AiSessionSummary ) {
	render(
		<ChatContextMenu session={ chat }>
			<div>
				<header>Header</header>
				<div data-chat-transcript>Transcript</div>
			</div>
		</ChatContextMenu>
	);
}

describe( 'ChatContextMenu', () => {
	it( 'opens the chat actions from the pane', async () => {
		renderPane( session );
		fireEvent.contextMenu( screen.getByText( 'Header' ) );
		expect( await screen.findByRole( 'menuitem', { name: /Pin/ } ) ).toBeVisible();
		expect( screen.getByRole( 'menuitem', { name: /Rename/ } ) ).toBeVisible();
		expect( screen.getByRole( 'menuitem', { name: /Archive/ } ) ).toBeVisible();
	} );

	it( 'leaves the transcript and a loading chat to the browser menu', () => {
		renderPane( session );
		fireEvent.contextMenu( screen.getByText( 'Transcript' ) );
		expect( screen.queryByRole( 'menu' ) ).not.toBeInTheDocument();

		renderPane();
		fireEvent.contextMenu( screen.getAllByText( 'Header' )[ 1 ] );
		expect( screen.queryByRole( 'menu' ) ).not.toBeInTheDocument();
	} );
} );
