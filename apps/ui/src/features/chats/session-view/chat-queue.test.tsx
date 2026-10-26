import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it } from 'vitest';
import { createFakeConnector, makeSession, makeSite } from '@/test/fake-connector';
import { renderApp } from '@/test/render';
import type { AgentRunEvent } from '@/data/core';
import type { FakeConnector } from '@/test/fake-connector';

const COMPOSER = { name: 'Message WordPress Studio' };

function emitRun( connector: FakeConnector, event: AgentRunEvent[ 'event' ] ) {
	act( () =>
		connector.emit( 'onAgentEvent', { sessionId: 'queue-chat', runId: 'queue-run', event } )
	);
}

beforeEach( () => {
	localStorage.clear();
} );

it( 'reopens a queued message for editing and queues only the revision', async () => {
	const site = makeSite( { id: 'one', path: '/sites/my-site' } );
	const connector = createFakeConnector(
		{
			sites: [ site ],
			sessions: [
				{
					summary: makeSession( {
						id: 'queue-chat',
						title: 'Queued conversation',
						ownerSiteId: 'one',
						ownerSitePath: site.path,
					} ),
					entries: [],
				},
			],
		},
		{ getFilePath: async () => '/tmp/notes.txt' }
	);
	renderApp( { connector, path: '/sessions/queue-chat' } );
	await screen.findByRole( 'button', { name: 'Site actions for My site' } );
	const input = await screen.findByRole( 'combobox', COMPOSER );
	await waitFor( () => expect( input ).toBeEnabled() );
	fireEvent.change( screen.getByLabelText( 'Upload attachments' ), {
		target: { files: [ new File( [ 'twelve bytes' ], 'notes.txt', { type: 'text/plain' } ) ] },
	} );
	await screen.findByText( 'notes.txt' );
	emitRun( connector, { type: 'run.started', timestamp: new Date().toISOString() } );
	fireEvent.change( input, { target: { value: 'Original follow-up' } } );
	fireEvent.click( await screen.findByRole( 'button', { name: 'Queue message' } ) );
	await screen.findByRole( 'button', { name: 'Edit queued message' } );
	fireEvent.click( screen.getByRole( 'button', { name: 'Start My site' } ) );
	await screen.findByRole( 'complementary', { name: 'Site preview' } );
	expect( screen.getByRole( 'combobox', COMPOSER ) ).toBe( input );
	expect( screen.getByText( 'Original follow-up' ) ).toBeVisible();
	fireEvent.click( await screen.findByRole( 'button', { name: 'Stop My site' } ) );
	await waitFor( () =>
		expect(
			screen.queryByRole( 'complementary', { name: 'Site preview' } )
		).not.toBeInTheDocument()
	);
	expect( screen.getByRole( 'combobox', COMPOSER ) ).toBe( input );
	expect( screen.getByRole( 'button', { name: 'Stop response' } ) ).toBeVisible();
	fireEvent.click( await screen.findByRole( 'button', { name: 'Edit queued message' } ) );
	expect( input ).toHaveValue( 'Original follow-up' );
	expect( input ).toHaveFocus();
	expect( screen.getByText( 'notes.txt' ) ).toBeVisible();
	expect(
		screen.queryByRole( 'button', { name: 'Remove queued message' } )
	).not.toBeInTheDocument();
	expect( connector.continueSession ).not.toHaveBeenCalled();
	fireEvent.change( input, { target: { value: 'Revised follow-up' } } );
	fireEvent.click( screen.getByRole( 'button', { name: 'Queue message' } ) );
	await screen.findByText( 'Revised follow-up' );
	expect( screen.queryByText( 'Original follow-up' ) ).not.toBeInTheDocument();
	expect( screen.getAllByRole( 'button', { name: 'Edit queued message' } ) ).toHaveLength( 1 );
	expect( connector.continueSession ).not.toHaveBeenCalled();
	connector.continueSession.mockResolvedValue( { runId: 'revision-run' } );
	emitRun( connector, {
		type: 'run.exited',
		timestamp: new Date().toISOString(),
		status: 'success',
		code: 0,
	} );
	await waitFor( () => expect( connector.continueSession ).toHaveBeenCalledTimes( 1 ) );
	expect( connector.continueSession ).toHaveBeenCalledWith(
		'queue-chat',
		'Revised follow-up',
		expect.objectContaining( {
			files: [
				expect.objectContaining( {
					name: 'notes.txt',
					path: '/tmp/notes.txt',
					size: 12,
					mimeType: 'text/plain',
				} ),
			],
		} )
	);
} );
