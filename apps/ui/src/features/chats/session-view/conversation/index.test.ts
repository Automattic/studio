import { fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
	agentQuestionEntry,
	assistantTextEntry,
	assistantToolCallEntry,
	promptEntry,
	toolResultEntry,
} from '@/features/chats/session-view/conversation/test-entries';
import {
	loadedSession,
	renderConversation,
} from '@/features/chats/session-view/conversation/test-render';
import type { SessionEntry } from '@/data/core';
import type { StudioChatArtifactWidgetDraft } from '@studio/common/ai/chat-artifacts';

const connectorMocks = vi.hoisted( () => ( {
	readLocalMediaFile: vi.fn(),
	copyText: vi.fn( () => Promise.resolve() ),
} ) );

const reducedMotion = vi.hoisted( () => ( { value: false } ) );

vi.mock( '@/lib/hooks', async ( importOriginal ) => ( {
	...( await importOriginal< typeof import('@/lib/hooks') >() ),
	useReducedMotion: () => reducedMotion.value,
} ) );

vi.mock( '@/features/chats/markdown', () => ( {
	Markdown: ( { children }: { children: string } ) => children,
} ) );

vi.mock( '@/data/core', () => ( {
	useConnector: () => connectorMocks,
} ) );

beforeEach( () => {
	connectorMocks.readLocalMediaFile.mockReset();
	connectorMocks.copyText.mockReset();
} );

describe( 'Assistant message copy button', () => {
	it( 'copies a whole reply from every reply, not just the newest', () => {
		renderConversation(
			loadedSession( [
				assistantTextEntry( 'Earlier reply.' ),
				assistantTextEntry( 'First part.', 'Second part.' ),
			] )
		);

		const buttons = screen.getAllByRole( 'button', { name: 'Copy message' } );
		expect( buttons ).toHaveLength( 2 );
		expect( screen.getByText( 'First part.' ).closest( '[data-message-text]' ) ).toHaveAttribute(
			'data-message-text',
			'First part.\n\nSecond part.'
		);

		fireEvent.click( buttons[ 1 ] );
		expect( connectorMocks.copyText ).toHaveBeenCalledWith( 'First part.\n\nSecond part.' );
	} );

	it( 'copies a prompt the user sent', () => {
		renderConversation( loadedSession( [ promptEntry( 'Hello there' ) ] ) );

		fireEvent.click( screen.getByRole( 'button', { name: 'Copy message' } ) );
		expect( connectorMocks.copyText ).toHaveBeenCalledWith( 'Hello there' );
	} );
} );

describe( 'Conversation tool rows', () => {
	it( 'keeps tool inputs and results hidden until the label row is clicked', async () => {
		const data = loadedSession( [
			assistantToolCallEntry( 'Bash', { command: 'npm test' } ),
			toolResultEntry( 'first output line\nsecond output line' ),
		] );

		renderConversation( data );

		expect( screen.queryByText( 'npm test' ) ).not.toBeInTheDocument();
		expect( screen.queryByText( /first output line/ ) ).not.toBeInTheDocument();

		const toolRow = screen.getByRole( 'button', { name: 'Run terminal command' } );
		expect( toolRow ).toHaveAttribute( 'aria-expanded', 'false' );

		fireEvent.click( toolRow );

		expect( toolRow ).toHaveAttribute( 'aria-expanded', 'true' );
		expect( screen.getByText( 'npm test' ) ).toBeInTheDocument();
		expect( screen.getByText( /first output line/ ) ).toBeInTheDocument();

		fireEvent.click( toolRow );

		expect( toolRow ).toHaveAttribute( 'aria-expanded', 'false' );
		await waitFor( () =>
			expect( screen.queryByText( /first output line/ ) ).not.toBeInTheDocument()
		);
	} );

	it( 'opens a failed tool row with its error, without terminal color codes', () => {
		const escape = String.fromCharCode( 27 );
		renderConversation(
			loadedSession( [
				assistantToolCallEntry( 'Bash', { command: 'npm test' } ),
				toolResultEntry( `${ escape }[31mcommand failed${ escape }[0m`, true ),
			] )
		);

		expect( screen.getByRole( 'button', { name: 'Run terminal command' } ) ).toHaveAttribute(
			'aria-expanded',
			'true'
		);
		expect( screen.getByText( 'command failed' ) ).toBeInTheDocument();
	} );

	it( 'shows long tool results in the opened details without an extra toggle', () => {
		const longOutput = Array.from(
			{ length: 13 },
			( _, index ) => `output line ${ index + 1 }`
		).join( '\n' );
		const data = loadedSession( [
			assistantToolCallEntry( 'Bash', { command: 'npm test' } ),
			toolResultEntry( longOutput ),
		] );

		renderConversation( data );

		fireEvent.click( screen.getByRole( 'button', { name: 'Run terminal command' } ) );

		expect( screen.getByText( /output line 13/ ) ).toBeInTheDocument();
		expect( screen.queryByRole( 'button', { name: 'Show more' } ) ).not.toBeInTheDocument();
		expect( screen.queryByRole( 'button', { name: 'Show less' } ) ).not.toBeInTheDocument();
	} );

	it( 'uses WP-CLI summaries while preserving the raw command in details', () => {
		const command =
			'post list --post_type=post --post_status=publish --fields=ID,post_title --format=table';
		const data = loadedSession( [
			assistantToolCallEntry( 'wp_cli', { nameOrPath: "Shaun's Blog", command } ),
			toolResultEntry( 'ID\tpost_title\n1\tHello world' ),
		] );

		renderConversation( data );

		const toolRow = screen.getByRole( 'button', { name: 'List published posts' } );
		expect( toolRow ).toBeInTheDocument();
		expect( screen.queryByText( /--fields=ID/ ) ).not.toBeInTheDocument();

		fireEvent.click( toolRow );

		expect(
			screen.getByText( ( content ) => content.includes( `wp ${ command }` ) )
		).toBeInTheDocument();
	} );

	it( 'combines the tool label and detail in the row accessible name', () => {
		const data = loadedSession( [
			assistantToolCallEntry( 'Read', { file_path: '/tmp/studio/app.tsx' } ),
		] );

		renderConversation( data );

		expect( screen.getByRole( 'button', { name: 'Read studio/app.tsx' } ) ).toBeInTheDocument();
	} );

	it( 'hides the raw Ask User tool row while showing the question UI', () => {
		const data = loadedSession( [
			assistantToolCallEntry( 'AskUserQuestion', {
				questions: [
					{
						question: "What kind of vibe do you want for your blog's design?",
						options: [
							{ label: 'Minimal & Clean', description: '' },
							{ label: 'Warm & Cozy', description: '' },
						],
					},
				],
			} ),
			agentQuestionEntry( "What kind of vibe do you want for your blog's design?", [
				'Minimal & Clean',
				'Warm & Cozy',
			] ),
		] );

		renderConversation( data );

		expect( screen.queryByText( 'Ask user' ) ).not.toBeInTheDocument();
		expect(
			screen.getByText( "What kind of vibe do you want for your blog's design?" )
		).toBeInTheDocument();
		expect( screen.getByRole( 'button', { name: 'Minimal & Clean' } ) ).toBeInTheDocument();
	} );

	it( 'hides legacy media payload markers from expanded tool details for any tool', () => {
		const data = loadedSession( [
			assistantToolCallEntry( 'take_screenshot', { url: 'http://localhost:8888/' } ),
			toolResultEntry(
				'Screenshot captured - desktop: captured full page (1248px tall).\n' +
					'mediaWidgetPayload={"type":"media","widgetProps":{"url":"file:///tmp/screenshot.jpg"}}'
			),
		] );

		renderConversation( data );
		fireEvent.click( screen.getByRole( 'button', { name: 'Take screenshot' } ) );

		expect( screen.getByText( /Screenshot captured/ ) ).toBeInTheDocument();
		expect( screen.queryByText( /mediaWidgetPayload/ ) ).not.toBeInTheDocument();
	} );
} );

describe( 'Conversation chat artifacts', () => {
	it( 'renders local screenshot media artifacts inline', async () => {
		connectorMocks.readLocalMediaFile.mockResolvedValue( {
			name: 'screenshot-desktop.jpg',
			mimeType: 'image/jpeg',
			data: new Uint8Array( [ 1, 2, 3 ] ).buffer,
		} );
		const data = loadedSession( [
			chatArtifactEntry( [
				{
					type: 'media',
					widgetProps: {
						url: 'file:///tmp/studio-screenshot/screenshot-desktop.jpg',
						mediaKind: 'image',
						alt: 'Screenshot of http://localhost:8888/ (desktop)',
						mediaId: null,
						source: {
							type: 'local',
							path: '/tmp/studio-screenshot/screenshot-desktop.jpg',
							name: 'screenshot-desktop.jpg',
							mimeType: 'image/jpeg',
						},
					},
				},
			] ),
		] );

		renderConversation( data );

		const screenshot = await screen.findByRole( 'img', {
			name: 'Screenshot of http://localhost:8888/ (desktop)',
		} );
		expect( screenshot ).toHaveAttribute( 'src', 'data:image/jpeg;base64,AQID' );
		expect( connectorMocks.readLocalMediaFile ).toHaveBeenCalledWith(
			'/tmp/studio-screenshot/screenshot-desktop.jpg'
		);
	} );

	it( 'shows a fallback when reading the local file fails', async () => {
		connectorMocks.readLocalMediaFile.mockRejectedValue( new Error( 'gone' ) );
		const data = loadedSession( [ chatArtifactEntry( [ localScreenshotWidget() ] ) ] );

		renderConversation( data );

		expect( await screen.findByText( 'Image could not load' ) ).toHaveAttribute( 'role', 'status' );
	} );
} );

function localScreenshotWidget(): StudioChatArtifactWidgetDraft {
	return {
		type: 'media',
		widgetProps: {
			url: 'file:///tmp/studio-screenshot/screenshot-desktop.jpg',
			mediaKind: 'image',
			alt: 'Screenshot of http://localhost:8888/ (desktop)',
			mediaId: null,
			source: {
				type: 'local',
				path: '/tmp/studio-screenshot/screenshot-desktop.jpg',
				name: 'screenshot-desktop.jpg',
				mimeType: 'image/jpeg',
			},
		},
	};
}

describe( 'Conversation turn activity', () => {
	it( 'shimmers the working line and the running tool until they finish', () => {
		renderConversation(
			loadedSession( [ promptEntry( 'Go' ), assistantToolCallEntry( 'Bash', { command: 'ls' } ) ] ),
			{ isRunning: true, startedAt: Date.now() }
		);

		expect( screen.getByText( 'Working for 0s' ) ).toHaveClass( 'studio-shimmer' );
		expect( screen.getByText( 'Run terminal command' ) ).toHaveClass( 'studio-shimmer' );
	} );
} );

function chatArtifactEntry( widgets: StudioChatArtifactWidgetDraft[] ): SessionEntry {
	return {
		type: 'custom',
		id: 'chat-artifact',
		parentId: null,
		timestamp: '2026-06-05T12:00:02.000Z',
		customType: 'studio.chat_artifact',
		data: {
			version: 1,
			id: 'artifact-1',
			widgets,
		},
	} as SessionEntry;
}
