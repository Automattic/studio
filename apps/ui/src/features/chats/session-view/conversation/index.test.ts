import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
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
import { createFakeConnector } from '@/test/fake-connector';
import type { SessionEntry } from '@/data/core';

describe( 'Conversation copy buttons', () => {
	it( 'copies any whole reply and the prompts the user sent', async () => {
		const { connector } = renderConversation(
			loadedSession( [
				promptEntry( 'Hello there' ),
				assistantTextEntry( 'Earlier reply.' ),
				assistantTextEntry( 'First part.', 'Second part.' ),
			] )
		);

		const buttons = screen.getAllByRole( 'button', { name: 'Copy message' } );
		expect( buttons ).toHaveLength( 3 );

		fireEvent.click( buttons[ 0 ] );
		await waitFor( () => expect( connector.copyText ).toHaveBeenCalledWith( 'Hello there' ) );
		fireEvent.click( buttons[ 1 ] );
		await waitFor( () => expect( connector.copyText ).toHaveBeenCalledWith( 'Earlier reply.' ) );
		fireEvent.click( buttons[ 2 ] );
		await waitFor( () =>
			expect( connector.copyText ).toHaveBeenCalledWith( 'First part.\n\nSecond part.' )
		);
	} );
} );

describe( 'Conversation tool rows', () => {
	it( 'shows long tool results in the opened details without an extra toggle', () => {
		const longOutput = Array.from(
			{ length: 13 },
			( _, index ) => `output line ${ index + 1 }`
		).join( '\n' );
		renderConversation(
			loadedSession( [
				assistantToolCallEntry( 'Bash', { command: 'npm test' } ),
				toolResultEntry( longOutput ),
			] )
		);

		fireEvent.click( screen.getByRole( 'button', { name: 'Run terminal command' } ) );

		expect( screen.getByText( /output line 13/ ) ).toBeInTheDocument();
		expect( screen.queryByRole( 'button', { name: 'Show more' } ) ).not.toBeInTheDocument();
		expect( screen.queryByRole( 'button', { name: 'Show less' } ) ).not.toBeInTheDocument();
	} );

	it( 'uses WP-CLI summaries while preserving the raw command in details', () => {
		const command =
			'post list --post_type=post --post_status=publish --fields=ID,post_title --format=table';
		renderConversation(
			loadedSession( [
				assistantToolCallEntry( 'wp_cli', { nameOrPath: "Shaun's Blog", command } ),
				toolResultEntry( 'ID\tpost_title\n1\tHello world' ),
			] )
		);

		const toolRow = screen.getByRole( 'button', { name: 'List published posts' } );
		expect( screen.queryByText( /--fields=ID/ ) ).not.toBeInTheDocument();

		fireEvent.click( toolRow );

		expect(
			screen.getByText( ( content ) => content.includes( `wp ${ command }` ) )
		).toBeInTheDocument();
	} );

	it( 'combines the tool label and detail in the row accessible name', () => {
		renderConversation(
			loadedSession( [ assistantToolCallEntry( 'Read', { file_path: '/tmp/studio/app.tsx' } ) ] )
		);

		expect( screen.getByRole( 'button', { name: 'Read studio/app.tsx' } ) ).toBeInTheDocument();
	} );

	it( 'hides the raw Ask User tool row while showing the question UI', () => {
		const question = "What kind of vibe do you want for your blog's design?";
		renderConversation(
			loadedSession( [
				assistantToolCallEntry( 'AskUserQuestion', {
					questions: [
						{
							question,
							options: [
								{ label: 'Minimal & Clean', description: '' },
								{ label: 'Warm & Cozy', description: '' },
							],
						},
					],
				} ),
				agentQuestionEntry( question, [ 'Minimal & Clean', 'Warm & Cozy' ] ),
			] )
		);

		expect( screen.queryByText( 'Ask user' ) ).not.toBeInTheDocument();
		expect( screen.getByText( question ) ).toBeInTheDocument();
		expect( screen.getByRole( 'radio', { name: 'Minimal & Clean' } ) ).toBeInTheDocument();
	} );
} );

describe( 'structured chat responses', () => {
	const renderEntries = ( entries: unknown[], connector = createFakeConnector() ) =>
		renderConversation( loadedSession( entries as SessionEntry[] ), { connector } );

	it.each( [ false, true ] )( 'expands tool results and errors (error: %s)', async ( isError ) => {
		renderEntries( [
			{
				type: 'message',
				id: 'tool',
				message: {
					role: 'assistant',
					content: [ { type: 'toolCall', id: 'read', name: 'read', arguments: { path: 'x' } } ],
				},
			},
			{
				type: 'message',
				id: 'result',
				message: {
					role: 'toolResult',
					toolCallId: 'read',
					content: [
						{
							type: 'text',
							text: isError ? '\u001b[2mFile is unavailable\u001b[22m' : '**File contents**',
						},
					],
					isError,
				},
			},
		] );
		const tool = await screen.findByRole( 'button', { name: 'read' } );
		expect( tool ).toHaveAttribute( 'aria-expanded', String( isError ) );
		if ( ! isError ) {
			fireEvent.click( tool );
		}
		expect(
			screen.getByText( isError ? 'File is unavailable' : /File contents/ )
		).toBeInTheDocument();
		expect( tool ).toHaveAttribute( 'aria-expanded', 'true' );
	} );

	const artifact = ( widgetProps: Record< string, unknown > ) => ( {
		type: 'custom',
		id: 'image',
		customType: 'studio.chat_artifact',
		data: { version: 1, id: 'capture', widgets: [ { type: 'media', widgetProps } ] },
	} );

	it( 'renders image artifacts with their accessible description', async () => {
		renderEntries( [
			artifact( {
				mediaKind: 'image',
				url: 'https://example.com/capture.png',
				alt: 'Mobile homepage capture',
			} ),
		] );
		expect( await screen.findByRole( 'img', { name: 'Mobile homepage capture' } ) ).toHaveAttribute(
			'src',
			'https://example.com/capture.png'
		);
	} );

	it( 'reports a missing local image without losing the transcript', async () => {
		const connector = createFakeConnector();
		connector.readLocalMediaFile.mockRejectedValue( new Error( 'File not found' ) );
		renderEntries(
			[
				artifact( { mediaKind: 'image', source: { type: 'local', path: '/missing/capture.png' } } ),
				{
					type: 'message',
					id: 'reply',
					message: { role: 'assistant', content: [ { type: 'text', text: 'Still available' } ] },
				},
			],
			connector
		);
		expect( await screen.findByText( 'Image could not load' ) ).toBeVisible();
		expect( screen.getByText( 'Still available' ) ).toBeVisible();
	} );

	it( 'renders interruption and failure markers alongside a later response', async () => {
		renderEntries( [
			{
				type: 'custom',
				id: 'stop',
				customType: 'studio.turn_closed',
				data: { status: 'interrupted' },
			},
			{
				type: 'custom',
				id: 'error',
				customType: 'studio.turn_closed',
				data: { status: 'error', errorMessage: 'Connection lost. Try again.' },
			},
			{
				type: 'message',
				id: 'recovery',
				message: {
					role: 'assistant',
					content: [
						{ type: 'thinking', thinking: 'Internal reasoning' },
						{ type: 'text', text: 'Ready to continue' },
					],
				},
			},
		] );
		expect( await screen.findByText( 'Interrupted by you' ) ).toHaveAttribute( 'role', 'status' );
		expect( screen.getByText( 'Connection lost. Try again.' ) ).toHaveAttribute( 'role', 'alert' );
		expect( screen.getByText( 'Ready to continue' ) ).toBeVisible();
		expect( screen.queryByText( 'Internal reasoning' ) ).not.toBeInTheDocument();
	} );
} );
