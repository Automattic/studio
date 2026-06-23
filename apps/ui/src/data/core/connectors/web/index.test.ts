import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createWebConnector } from '.';

describe( 'createWebConnector', () => {
	beforeEach( () => {
		vi.stubGlobal(
			'fetch',
			vi.fn( async () => new Response( JSON.stringify( { runId: 'run-1' } ) ) )
		);
	} );

	afterEach( () => {
		vi.unstubAllGlobals();
	} );

	it( 'forwards attachments when continuing a session', async () => {
		const connector = createWebConnector( { apiBaseUrl: 'http://localhost:8088' } );

		await connector.continueSession( 'session-1', 'Please review the attachment.', {
			displayMessage: 'Please review the attachment.',
			images: [
				{
					id: 'image-1',
					name: 'screenshot.png',
					mimeType: 'image/png',
					size: 12,
					dataBase64: 'aW1hZ2U=',
				},
			],
			files: [
				{
					id: 'file-1',
					name: 'notes.txt',
					path: '/tmp/notes.txt',
					mimeType: 'text/plain',
					size: 18,
				},
			],
		} );

		expect( fetch ).toHaveBeenCalledWith(
			'http://localhost:8088/api/sessions/session-1/messages',
			expect.objectContaining( {
				method: 'POST',
				body: JSON.stringify( {
					prompt: 'Please review the attachment.',
					displayMessage: 'Please review the attachment.',
					images: [
						{
							id: 'image-1',
							name: 'screenshot.png',
							mimeType: 'image/png',
							size: 12,
							dataBase64: 'aW1hZ2U=',
						},
					],
					files: [
						{
							id: 'file-1',
							name: 'notes.txt',
							path: '/tmp/notes.txt',
							mimeType: 'text/plain',
							size: 18,
						},
					],
				} ),
			} )
		);
	} );
} );
