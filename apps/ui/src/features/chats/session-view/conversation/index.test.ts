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
