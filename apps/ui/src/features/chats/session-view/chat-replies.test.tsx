import { fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { createFakeConnector, makeSession, makeSite } from '@/test/fake-connector';
import { renderApp } from '@/test/render';
import {
	promptEntry,
	assistantTextEntry,
	assistantToolCallEntry,
	toolResultEntry,
	turnClosedEntry,
} from '@/test/session-entries';
import type { SessionEntry } from '@/data/core';

beforeEach( () => localStorage.clear() );
async function setup( prompt = promptEntry( 'Help with the palette' ), messageReplies = true ) {
	const site = makeSite( { id: 'one', path: '/sites/one', running: true } );
	const entries = [
		prompt,
		assistantTextEntry( 'Use a coral palette for the header.' ),
		turnClosedEntry( 'success' ),
	];
	const summary = makeSession( {
		id: 'interactions-chat',
		ownerSiteId: 'one',
		ownerSitePath: site.path,
		title: 'Palette',
	} );
	const connector = createFakeConnector(
		{ sites: [ site ], sessions: [ { summary, entries } ] },
		{ capabilities: { messageReplies } }
	);
	renderApp( { connector, path: '/sessions/interactions-chat' } );
	await screen.findByText( 'Use a coral palette for the header.' );
	const input = await screen.findByRole( 'combobox', { name: 'Message WordPress Studio' } );
	return { connector, input, entries, summary };
}
it.each( [
	{ sender: 'user', messageIndex: 0, excerpt: 'Help with the palette' },
	{ sender: 'assistant', messageIndex: 1, excerpt: 'Use a coral palette for the header.' },
] )(
	'keeps a reply to a $sender message separate from the draft and sends its source reference',
	async ( { messageIndex, excerpt } ) => {
		const { connector, input, entries } = await setup();
		fireEvent.change( input, { target: { value: 'Make it a little warmer' } } );
		fireEvent.click( screen.getAllByRole( 'button', { name: 'Reply' } )[ messageIndex ] );
		expect( input ).toHaveValue( 'Make it a little warmer' );
		expect( screen.getByText( 'Replying to' ) ).toBeVisible();
		fireEvent.click( screen.getByRole( 'button', { name: 'Remove reply' } ) );
		expect( input ).toHaveValue( 'Make it a little warmer' );
		expect( screen.queryByText( 'Replying to' ) ).not.toBeInTheDocument();
		fireEvent.click( screen.getAllByRole( 'button', { name: 'Reply' } )[ messageIndex ] );
		expect( screen.getByRole( 'combobox', { name: 'Message WordPress Studio' } ) ).toHaveValue(
			'Make it a little warmer'
		);
		fireEvent.click( screen.getByRole( 'button', { name: 'Send message' } ) );
		await waitFor( () =>
			expect( connector.continueSession ).toHaveBeenCalledWith(
				'interactions-chat',
				'Make it a little warmer',
				expect.objectContaining( {
					reply: {
						sessionId: 'interactions-chat',
						entryId: entries[ messageIndex ].id,
						excerpt,
					},
				} )
			)
		);
	}
);
it( 'replies to an image-only message with its filename as context', async () => {
	const prompt = {
		...promptEntry( '' ),
		data: {
			source: 'prompt',
			text: '',
			attachments: [
				{
					kind: 'image',
					name: 'header.png',
					previewDataUrl: 'data:image/png;base64,eA==',
				},
			],
		},
	} as SessionEntry;
	const { connector, input } = await setup( prompt );
	fireEvent.click( screen.getAllByRole( 'button', { name: 'Reply' } )[ 0 ] );
	expect( screen.getByText( 'header.png' ) ).toBeVisible();
	fireEvent.change( input, { target: { value: 'Make this heading larger' } } );
	fireEvent.click( screen.getByRole( 'button', { name: 'Send message' } ) );
	await waitFor( () =>
		expect( connector.continueSession ).toHaveBeenCalledWith(
			'interactions-chat',
			'Make this heading larger',
			expect.objectContaining( {
				reply: { sessionId: 'interactions-chat', entryId: prompt.id, excerpt: 'header.png' },
			} )
		)
	);
} );

it( 'keeps copy available without offering replies on older hosts', async () => {
	const { connector } = await setup( promptEntry( 'Help with the palette' ), false );
	expect( screen.queryByRole( 'button', { name: 'Reply' } ) ).not.toBeInTheDocument();
	fireEvent.click( screen.getAllByRole( 'button', { name: 'Copy message' } )[ 0 ] );
	await waitFor( () =>
		expect( connector.copyText ).toHaveBeenCalledWith( 'Help with the palette' )
	);
} );

it( 'jumps to the original message every time the same reply reference is clicked', async () => {
	const site = makeSite( { id: 'one', path: '/sites/one', running: true } );
	const original = promptEntry( 'Keep the language casual.' );
	const summary = makeSession( {
		id: 'reply-jump',
		ownerSiteId: site.id,
		ownerSitePath: site.path,
	} );
	const entries: SessionEntry[] = [
		original,
		assistantTextEntry( 'I will keep it conversational.' ),
		turnClosedEntry( 'success' ),
		{
			...promptEntry( 'Which part?' ),
			data: {
				source: 'prompt',
				text: 'Which part?',
				reply: {
					sessionId: summary.id,
					entryId: original.id,
					excerpt: 'Keep the language casual.',
				},
			},
		} as SessionEntry,
	];
	const connector = createFakeConnector( { sites: [ site ], sessions: [ { summary, entries } ] } );
	const { user } = renderApp( { connector, path: '/sessions/reply-jump' } );
	await screen.findByRole( 'combobox', { name: 'Message WordPress Studio' } );
	const reference = await screen.findByRole( 'link', { name: 'Keep the language casual.' } );
	const target = document.querySelector< HTMLElement >( `[data-message-id="${ original.id }"]` )!;
	const jump = vi.spyOn( target, 'scrollIntoView' );
	for ( const count of [ 1, 2 ] ) {
		await user.click( reference );
		await waitFor( () => expect( jump ).toHaveBeenCalledTimes( count ) );
		expect( target ).toHaveAttribute( 'data-highlighted' );
		expect( target ).toHaveFocus();
	}
	jump.mockRestore();
} );

it( 'opens collapsed work before following a reference to an earlier assistant message', async () => {
	const site = makeSite( { id: 'one', path: '/sites/one', running: true } );
	const original = assistantToolCallEntry(
		'Read',
		{ path: 'theme.json' },
		'I will check the existing palette.'
	);
	const summary = makeSession( {
		id: 'reply-to-work',
		ownerSiteId: site.id,
		ownerSitePath: site.path,
	} );
	const entries: SessionEntry[] = [
		promptEntry( 'Check the palette' ),
		original,
		toolResultEntry( 'red' ),
		assistantTextEntry( 'The palette uses red.' ),
		turnClosedEntry( 'success' ),
		{
			...promptEntry( 'Which palette?' ),
			data: {
				source: 'prompt',
				text: 'Which palette?',
				reply: {
					sessionId: summary.id,
					entryId: original.id,
					excerpt: 'I will check the existing palette.',
				},
			},
		} as SessionEntry,
	];
	const connector = createFakeConnector( { sites: [ site ], sessions: [ { summary, entries } ] } );
	const { user } = renderApp( { connector, path: '/sessions/reply-to-work' } );
	await screen.findByRole( 'combobox', { name: 'Message WordPress Studio' } );
	const reference = await screen.findByRole( 'link', {
		name: 'I will check the existing palette.',
	} );
	expect(
		document.querySelector( `[data-message-id="${ original.id }"]` )
	).not.toBeInTheDocument();
	await user.click( reference );
	await waitFor( () =>
		expect( document.querySelector( `[data-message-id="${ original.id }"]` ) ).toHaveAttribute(
			'data-highlighted'
		)
	);
	expect( document.querySelector( `[data-message-id="${ original.id }"]` ) ).toHaveFocus();
} );

it( 'uses the durable prompt identity after the entry is persisted', async () => {
	const prompt = {
		...promptEntry( 'Help with the palette' ),
		data: { source: 'prompt', text: 'Help with the palette', inputId: 'original-input' },
	} as SessionEntry;
	const { connector, input } = await setup( prompt );
	fireEvent.click( screen.getAllByRole( 'button', { name: 'Reply' } )[ 0 ] );
	fireEvent.change( input, { target: { value: 'Make it warmer' } } );
	fireEvent.click( screen.getByRole( 'button', { name: 'Send message' } ) );
	await waitFor( () =>
		expect( connector.continueSession ).toHaveBeenCalledWith(
			'interactions-chat',
			'Make it warmer',
			expect.objectContaining( { reply: expect.objectContaining( { entryId: 'original-input' } ) } )
		)
	);
} );
