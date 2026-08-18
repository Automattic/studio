import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { readAiSessionSummaryFromEntries, readAiSessionSummaryFromFile } from '../summary';
import type { SessionEntry } from '@earendil-works/pi-coding-agent';

describe( 'readAiSessionSummaryFromEntries', () => {
	let rootDirectory: string | undefined;

	afterEach( async () => {
		if ( rootDirectory ) {
			await fs.rm( rootDirectory, { recursive: true, force: true } );
			rootDirectory = undefined;
		}
	} );

	it( 'includes the latest assistant reply preview', async () => {
		rootDirectory = await fs.mkdtemp( path.join( os.tmpdir(), 'studio-session-summary-' ) );
		const filePath = path.join( rootDirectory, 'session.jsonl' );
		await fs.writeFile( filePath, '' );

		const summary = await readAiSessionSummaryFromEntries( filePath, [
			{ type: 'session', id: 'session-1', timestamp: '2026-05-12T17:00:00.000Z' },
			{
				type: 'custom',
				customType: 'studio.user_prompt',
				timestamp: '2026-05-12T17:01:00.000Z',
				data: { source: 'prompt', text: 'Create a landing page' },
			} as SessionEntry,
			{
				type: 'message',
				timestamp: '2026-05-12T17:02:00.000Z',
				message: {
					role: 'assistant',
					content: [ { type: 'text', text: 'First reply\nwith extra spacing.' } ],
				},
			} as SessionEntry,
			{
				type: 'message',
				timestamp: '2026-05-12T17:03:00.000Z',
				message: {
					role: 'assistant',
					content: [ { type: 'text', text: 'Latest reply with markdown **bold**.' } ],
				},
			} as SessionEntry,
		] );

		expect( summary?.assistantReplyPreview ).toBe( 'Latest reply with markdown **bold**.' );
	} );

	it( 'streams a summary directly from a session file', async () => {
		rootDirectory = await fs.mkdtemp( path.join( os.tmpdir(), 'studio-session-summary-' ) );
		const filePath = path.join( rootDirectory, 'session.jsonl' );
		await fs.writeFile(
			filePath,
			[
				JSON.stringify( {
					type: 'session',
					id: 'session-1',
					timestamp: '2026-05-12T17:00:00.000Z',
				} ),
				JSON.stringify( {
					type: 'custom',
					customType: 'studio.user_prompt',
					timestamp: '2026-05-12T17:01:00.000Z',
					data: { source: 'prompt', text: 'Create a landing page' },
				} ),
				'{ malformed',
				JSON.stringify( {
					type: 'message',
					timestamp: '2026-05-12T17:02:00.000Z',
					message: {
						role: 'assistant',
						content: [ { type: 'text', text: 'Finished the landing page.' } ],
					},
				} ),
			].join( '\n' ) + '\n'
		);

		await expect( readAiSessionSummaryFromFile( filePath ) ).resolves.toMatchObject( {
			id: 'session-1',
			createdAt: '2026-05-12T17:00:00.000Z',
			updatedAt: '2026-05-12T17:02:00.000Z',
			firstPrompt: 'Create a landing page',
			assistantReplyPreview: 'Finished the landing page.',
			eventCount: 2,
		} );
	} );
} );
