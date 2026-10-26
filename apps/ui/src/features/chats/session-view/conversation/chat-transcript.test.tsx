import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Conversation } from '@/features/chats/session-view/conversation';
import { createFakeConnector, makeSession } from '@/test/fake-connector';
import { renderWithProviders } from '@/test/render';
import type { SessionEntry } from '@/data/core';
import type { ComponentProps } from 'react';

function renderEntries(
	entries: unknown[],
	{
		connector = createFakeConnector(),
		...props
	}: Partial< ComponentProps< typeof Conversation > > & {
		connector?: ReturnType< typeof createFakeConnector >;
	} = {}
) {
	return renderWithProviders(
		<Conversation
			data={ { summary: makeSession( { id: 'chat' } ), entries: entries as SessionEntry[] } }
			isRunning={ false }
			startedAt={ null }
			pendingQuestions={ new Set() }
			pendingAnswers={ {} }
			freeFormQuestion={ null }
			onAnswerQuestion={ vi.fn() }
			onChooseFreeForm={ vi.fn() }
			{ ...props }
		/>,
		{ connector }
	);
}

const joinState = ( element: Element | null ) => [
	!! element?.hasAttribute( 'data-joined-above' ),
	!! element?.hasAttribute( 'data-joined-below' ),
];

describe( 'structured chat responses', () => {
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
			{ connector }
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

describe( 'message grouping', () => {
	const assistant = ( id: string, content: unknown[] = [ { type: 'text', text: id } ] ) => ( {
		type: 'message',
		id,
		message: { role: 'assistant', content },
	} );
	const user = ( id: string ) => ( {
		type: 'custom',
		id,
		customType: 'studio.user_prompt',
		data: { source: 'prompt', text: id },
	} );
	const bubble = ( text: string ) => screen.getByText( text ).closest( '[data-message-text]' );

	it( 'joins consecutive messages from either sender and resets on a sender change', async () => {
		renderEntries( [
			assistant( 'first' ),
			assistant( 'middle' ),
			assistant( 'last' ),
			user( 'user-first' ),
			user( 'user-last' ),
			assistant( 'single' ),
		] );
		await screen.findByText( 'single' );
		expect(
			[ 'first', 'middle', 'last', 'user-first', 'user-last', 'single' ].map( ( text ) =>
				joinState( bubble( text ) )
			)
		).toEqual( [
			[ false, true ],
			[ true, true ],
			[ true, false ],
			[ false, true ],
			[ true, false ],
			[ false, false ],
		] );
	} );

	it( 'joins text and questionnaires as assistant messages', async () => {
		renderEntries( [
			assistant( 'before-question' ),
			{
				type: 'custom',
				id: 'answered',
				customType: 'studio.agent_question',
				data: { question: 'Choose a layout', options: [], selectedLabel: 'Grid' },
			},
			assistant( 'after-question' ),
			user( 'new-turn' ),
		] );
		const card = ( await screen.findByRole( 'group', { name: 'Choose a layout' } ) ).parentElement;
		expect(
			[ bubble( 'before-question' ), card, bubble( 'after-question' ), bubble( 'new-turn' ) ].map(
				joinState
			)
		).toEqual( [
			[ false, true ],
			[ true, true ],
			[ true, false ],
			[ false, false ],
		] );
	} );

	it( 'breaks the group when a visible tool separates messages', async () => {
		renderEntries( [
			assistant( 'before-tool' ),
			assistant( 'tool', [ { type: 'toolCall', id: 'tool-call', name: 'read' } ] ),
			assistant( 'after-tool' ),
		] );
		await screen.findByText( 'after-tool' );
		for ( const text of [ 'before-tool', 'after-tool' ] ) {
			expect( bubble( text ) ).not.toHaveAttribute( 'data-joined-above' );
			expect( bubble( text ) ).not.toHaveAttribute( 'data-joined-below' );
		}
	} );
} );

describe( 'chat questionnaire', () => {
	const question = ( multiSelect = false ) => [
		{
			type: 'custom',
			id: 'question',
			customType: 'studio.agent_question',
			data: {
				question: 'Choose a layout',
				multiSelect,
				options: [
					{ label: 'Grid', description: 'Equal columns' },
					{ label: 'Stack', description: 'Vertical content' },
				],
			},
		},
	];

	it( 'answers single-choice questions', async () => {
		const answer = vi.fn();
		renderEntries( question(), {
			pendingQuestions: new Set( [ 'Choose a layout' ] ),
			onAnswerQuestion: answer,
		} );
		fireEvent.click( await screen.findByRole( 'radio', { name: /Grid/ } ) );
		expect( answer ).toHaveBeenCalledWith( 'Choose a layout', 'Grid' );
	} );

	it( 'submits multiple choices together', async () => {
		const answer = vi.fn();
		renderEntries( question( true ), {
			pendingQuestions: new Set( [ 'Choose a layout' ] ),
			onAnswerQuestion: answer,
		} );
		fireEvent.click( await screen.findByRole( 'checkbox', { name: /Grid/ } ) );
		fireEvent.click( screen.getByRole( 'checkbox', { name: /Stack/ } ) );
		fireEvent.click( screen.getByRole( 'button', { name: 'Submit choices' } ) );
		expect( answer ).toHaveBeenCalledWith( 'Choose a layout', 'Grid, Stack' );
	} );
} );
