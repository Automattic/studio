import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import {
	AiSessionRecorder,
	getAiSessionsDirectoryForDate,
	readAiSessionEventsFromFile,
} from 'cli/lib/ai-sessions';

describe( 'ai-sessions', () => {
	let testRoot: string | undefined;

	afterEach( async () => {
		delete process.env.E2E;
		delete process.env.E2E_APP_DATA_PATH;

		if ( testRoot ) {
			await fs.rm( testRoot, { recursive: true, force: true } );
			testRoot = undefined;
		}
	} );

	it( 'stores minimal conversation events as jsonl with explicit timestamp fields', async () => {
		testRoot = await fs.mkdtemp( path.join( os.tmpdir(), 'studio-ai-sessions-' ) );
		process.env.E2E = '1';
		process.env.E2E_APP_DATA_PATH = testRoot;

		const startedAt = new Date( '2026-03-11T10:00:00.000Z' );
		const recorder = await AiSessionRecorder.create( { startedAt } );

		await recorder.recordSiteSelected( {
			name: 'My WordPress Website',
			path: '/tmp/my-wordpress-website',
		} );
		await recorder.recordUserMessage( {
			text: 'Help me create a plugin',
			source: 'prompt',
			sitePath: '/tmp/my-wordpress-website',
		} );
		await recorder.recordAssistantMessage( [
			{ type: 'text', text: 'Sure, I can help with that.' },
			{ type: 'tool_use', name: 'Read' },
		] );
		await recorder.recordToolResult( {
			ok: true,
			text: 'File read successfully',
		} );
		await recorder.recordAgentQuestion( {
			question: 'Choose a plugin slug',
			options: [
				{
					label: 'my-plugin',
					description: 'Use default slug',
				},
			],
		} );
		await recorder.recordUserMessage( {
			text: 'my-plugin',
			source: 'ask_user',
		} );
		await recorder.recordAgentSessionId( 'agent-session-1' );
		await recorder.recordTurnClosed( 'success' );

		const events = await readAiSessionEventsFromFile( recorder.filePath );
		expect( recorder.filePath.startsWith( getAiSessionsDirectoryForDate( startedAt ) ) ).toBe(
			true
		);
		expect( events[ 0 ] ).toMatchObject( {
			type: 'session.started',
			version: 1,
			sessionId: recorder.sessionId,
			timestamp: startedAt.toISOString(),
		} );
		expect( events.find( ( event ) => event.type === 'user.message' ) ).toMatchObject( {
			type: 'user.message',
			source: 'prompt',
			text: 'Help me create a plugin',
		} );
		expect( events.find( ( event ) => event.type === 'assistant.message' ) ).toMatchObject( {
			type: 'assistant.message',
			blocks: [
				{ type: 'text', text: 'Sure, I can help with that.' },
				{ type: 'tool_use', name: 'Read' },
			],
		} );
		expect( events.find( ( event ) => event.type === 'turn.closed' ) ).toMatchObject( {
			type: 'turn.closed',
			status: 'success',
		} );

		const hasShortTimestampKey = events.some(
			( event ) => typeof event === 'object' && event && 't' in event
		);
		expect( hasShortTimestampKey ).toBe( false );
	} );

	it( 'deduplicates linked agent session ids', async () => {
		testRoot = await fs.mkdtemp( path.join( os.tmpdir(), 'studio-ai-sessions-' ) );
		process.env.E2E = '1';
		process.env.E2E_APP_DATA_PATH = testRoot;

		const recorder = await AiSessionRecorder.create();
		await recorder.recordAgentSessionId( 'agent-session-1' );
		await recorder.recordAgentSessionId( 'agent-session-1' );
		await recorder.recordAgentSessionId( 'agent-session-2' );

		const events = await readAiSessionEventsFromFile( recorder.filePath );
		const linkedEvents = events.filter( ( event ) => event.type === 'session.linked' );
		expect( linkedEvents ).toHaveLength( 2 );
		expect( linkedEvents ).toMatchObject( [
			{
				type: 'session.linked',
				agentSessionId: 'agent-session-1',
			},
			{
				type: 'session.linked',
				agentSessionId: 'agent-session-2',
			},
		] );
	} );
} );
