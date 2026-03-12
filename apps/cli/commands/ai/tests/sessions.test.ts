import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getAiSessionsDirectoryForDate, getAiSessionsRootDirectory } from 'cli/ai/sessions/paths';
import { AiSessionRecorder } from 'cli/ai/sessions/recorder';
import { replaySessionHistory } from 'cli/ai/sessions/replay';
import {
	deleteAiSession,
	listAiSessions,
	loadAiSession,
	readAiSessionEventsFromFile,
} from 'cli/ai/sessions/store';
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import type { AiSessionEvent } from 'cli/ai/sessions/types';

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
		await recorder.recordSessionContext( {
			provider: 'anthropic-api-key',
			model: 'claude-sonnet-4-6',
			cwd: '/tmp/my-wordpress-website',
		} );
		await recorder.recordSdkMessage( {
			type: 'assistant',
			message: {
				content: [
					{
						type: 'text',
						text: 'Sure, I can help with that.',
					},
				],
			},
		} as SDKMessage );
		await recorder.recordToolProgress( 'Starting process daemon…' );
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
		const fileName = path.basename( recorder.filePath );
		expect( fileName ).toBe( `2026-03-11T10-00-00-${ recorder.sessionId }.jsonl` );
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
		expect( events.find( ( event ) => event.type === 'sdk.message' ) ).toMatchObject( {
			type: 'sdk.message',
			message: {
				type: 'assistant',
			},
		} );
		expect( events.find( ( event ) => event.type === 'session.context' ) ).toMatchObject( {
			type: 'session.context',
			provider: 'anthropic-api-key',
			model: 'claude-sonnet-4-6',
			cwd: '/tmp/my-wordpress-website',
		} );
		expect( events.find( ( event ) => event.type === 'tool.progress' ) ).toMatchObject( {
			type: 'tool.progress',
			message: 'Starting process daemon…',
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

	it( 'loads sessions by id prefix with linked Claude session metadata', async () => {
		testRoot = await fs.mkdtemp( path.join( os.tmpdir(), 'studio-ai-sessions-' ) );
		process.env.E2E = '1';
		process.env.E2E_APP_DATA_PATH = testRoot;

		const recorder = await AiSessionRecorder.create();
		await recorder.recordUserMessage( {
			text: 'Hello there',
			source: 'prompt',
		} );
		await recorder.recordAgentSessionId( 'agent-session-123' );
		await recorder.recordTurnClosed( 'success' );

		const prefix = recorder.sessionId.slice( 0, 8 );
		const loadedSession = await loadAiSession( prefix );
		expect( loadedSession.summary.id ).toBe( recorder.sessionId );
		expect( loadedSession.summary.agentSessionId ).toBe( 'agent-session-123' );
		expect( loadedSession.summary.linkedAgentSessionIds ).toEqual( [ 'agent-session-123' ] );
		expect( loadedSession.events.some( ( event ) => event.type === 'turn.closed' ) ).toBe( true );
	} );

	it( 'opens an existing session recorder and appends to the same file', async () => {
		testRoot = await fs.mkdtemp( path.join( os.tmpdir(), 'studio-ai-sessions-' ) );
		process.env.E2E = '1';
		process.env.E2E_APP_DATA_PATH = testRoot;

		const recorder = await AiSessionRecorder.create();
		await recorder.recordAgentSessionId( 'agent-session-1' );
		await recorder.recordUserMessage( {
			text: 'First message',
			source: 'prompt',
		} );

		const reopenedRecorder = await AiSessionRecorder.open( {
			sessionId: recorder.sessionId,
			filePath: recorder.filePath,
			linkedAgentSessionIds: [ 'agent-session-1' ],
		} );
		await reopenedRecorder.recordTurnClosed( 'success' );

		const sessions = await listAiSessions();
		expect( sessions ).toHaveLength( 1 );
		expect( sessions[ 0 ] ).toMatchObject( {
			id: recorder.sessionId,
			filePath: recorder.filePath,
			agentSessionId: 'agent-session-1',
			linkedAgentSessionIds: [ 'agent-session-1' ],
		} );

		const events = await readAiSessionEventsFromFile( recorder.filePath );
		expect( events[ events.length - 1 ] ).toMatchObject( {
			type: 'turn.closed',
			status: 'success',
		} );
	} );

	it( 'builds list summaries with prompt, selected site, end reason, and event count', async () => {
		testRoot = await fs.mkdtemp( path.join( os.tmpdir(), 'studio-ai-sessions-' ) );
		process.env.E2E = '1';
		process.env.E2E_APP_DATA_PATH = testRoot;

		const recorder = await AiSessionRecorder.create();
		await recorder.recordSiteSelected( {
			name: 'My WordPress Website',
			path: '/tmp/my-wordpress-website',
		} );
		await recorder.recordUserMessage( {
			text: 'Create a homepage for me',
			source: 'prompt',
		} );
		await recorder.recordTurnClosed( 'interrupted' );

		const sessions = await listAiSessions();
		expect( sessions ).toHaveLength( 1 );
		expect( sessions[ 0 ] ).toMatchObject( {
			id: recorder.sessionId,
			firstPrompt: 'Create a homepage for me',
			selectedSiteName: 'My WordPress Website',
			endReason: 'stopped',
		} );
		expect( sessions[ 0 ].eventCount ).toBeGreaterThanOrEqual( 4 );
	} );

	it( 'deletes a session by id prefix and prunes empty date directories', async () => {
		testRoot = await fs.mkdtemp( path.join( os.tmpdir(), 'studio-ai-sessions-' ) );
		process.env.E2E = '1';
		process.env.E2E_APP_DATA_PATH = testRoot;

		const startedAt = new Date( '2026-03-11T10:00:00.000Z' );
		const recorder = await AiSessionRecorder.create( { startedAt } );
		await recorder.recordUserMessage( {
			text: 'Delete me',
			source: 'prompt',
		} );

		const deleted = await deleteAiSession( recorder.sessionId.slice( 0, 8 ) );
		expect( deleted.id ).toBe( recorder.sessionId );

		const sessions = await listAiSessions();
		expect( sessions ).toHaveLength( 0 );

		const dayDirectory = getAiSessionsDirectoryForDate( startedAt );
		const monthDirectory = path.dirname( dayDirectory );
		const yearDirectory = path.dirname( monthDirectory );
		await expect( fs.access( dayDirectory ) ).rejects.toThrow();
		await expect( fs.access( monthDirectory ) ).rejects.toThrow();
		await expect( fs.access( yearDirectory ) ).rejects.toThrow();

		await expect( fs.access( getAiSessionsRootDirectory() ) ).resolves.not.toThrow();
	} );

	it( 'keeps date directories when deleting one of multiple sessions from the same day', async () => {
		testRoot = await fs.mkdtemp( path.join( os.tmpdir(), 'studio-ai-sessions-' ) );
		process.env.E2E = '1';
		process.env.E2E_APP_DATA_PATH = testRoot;

		const firstStart = new Date( '2026-03-11T10:00:00.000Z' );
		const secondStart = new Date( '2026-03-11T11:00:00.000Z' );
		const firstRecorder = await AiSessionRecorder.create( { startedAt: firstStart } );
		const secondRecorder = await AiSessionRecorder.create( { startedAt: secondStart } );

		await firstRecorder.recordUserMessage( {
			text: 'Delete me',
			source: 'prompt',
		} );
		await secondRecorder.recordUserMessage( {
			text: 'Keep me',
			source: 'prompt',
		} );

		await deleteAiSession( firstRecorder.sessionId );

		const sessions = await listAiSessions();
		expect( sessions ).toHaveLength( 1 );
		expect( sessions[ 0 ].id ).toBe( secondRecorder.sessionId );

		const dayDirectory = getAiSessionsDirectoryForDate( firstStart );
		const monthDirectory = path.dirname( dayDirectory );
		const yearDirectory = path.dirname( monthDirectory );

		await expect( fs.access( dayDirectory ) ).resolves.not.toThrow();
		await expect( fs.access( monthDirectory ) ).resolves.not.toThrow();
		await expect( fs.access( yearDirectory ) ).resolves.not.toThrow();
	} );

	it( 'throws when deleting a missing session id or prefix', async () => {
		testRoot = await fs.mkdtemp( path.join( os.tmpdir(), 'studio-ai-sessions-' ) );
		process.env.E2E = '1';
		process.env.E2E_APP_DATA_PATH = testRoot;

		await expect( deleteAiSession( 'does-not-exist' ) ).rejects.toThrow(
			'AI session not found: does-not-exist'
		);
	} );

	it( 'throws when deleting an ambiguous id prefix', async () => {
		testRoot = await fs.mkdtemp( path.join( os.tmpdir(), 'studio-ai-sessions-' ) );
		process.env.E2E = '1';
		process.env.E2E_APP_DATA_PATH = testRoot;

		await AiSessionRecorder.create( { startedAt: new Date( '2026-03-11T10:00:00.000Z' ) } );
		await AiSessionRecorder.create( { startedAt: new Date( '2026-03-11T11:00:00.000Z' ) } );

		await expect( deleteAiSession( '' ) ).rejects.toThrow( 'Session id prefix is ambiguous' );
	} );

	it( 'lists sessions with most recent update first (latest semantics)', async () => {
		testRoot = await fs.mkdtemp( path.join( os.tmpdir(), 'studio-ai-sessions-' ) );
		process.env.E2E = '1';
		process.env.E2E_APP_DATA_PATH = testRoot;

		const older = await AiSessionRecorder.create( {
			startedAt: new Date( '2026-03-10T10:00:00.000Z' ),
		} );
		const latest = await AiSessionRecorder.create( {
			startedAt: new Date( '2026-03-11T10:00:00.000Z' ),
		} );

		const sessions = await listAiSessions();
		expect( sessions.map( ( session ) => session.id ) ).toEqual( [
			latest.sessionId,
			older.sessionId,
		] );
	} );

	it( 'replays raw sdk.message events', () => {
		const ui = {
			activeSite: null,
			prepareForReplay: vi.fn(),
			finishReplay: vi.fn(),
			setReplayTimestamp: vi.fn(),
			setActiveSite: vi.fn(),
			beginAgentTurn: vi.fn(),
			addUserMessage: vi.fn(),
			handleMessage: vi.fn(),
			setLoaderMessage: vi.fn(),
			showAgentQuestion: vi.fn(),
			endAgentTurn: vi.fn(),
		};
		const sdkAssistantMessage = {
			type: 'assistant',
			message: {
				content: [
					{
						type: 'text',
						text: 'hello from sdk replay',
					},
				],
			},
		};
		const events: AiSessionEvent[] = [
			{
				type: 'sdk.message',
				timestamp: '2026-03-12T10:00:01.000Z',
				message: sdkAssistantMessage as SDKMessage,
			},
		];

		replaySessionHistory( ui as never, events );

		expect( ui.prepareForReplay ).toHaveBeenCalledTimes( 1 );
		expect( ui.handleMessage ).toHaveBeenCalledTimes( 1 );
		expect( ui.handleMessage ).toHaveBeenCalledWith( sdkAssistantMessage );
		expect( ui.finishReplay ).toHaveBeenCalledTimes( 1 );
	} );

	it( 'skips ask_user echo lines during replay and starts turns on prompt messages', () => {
		const ui = {
			activeSite: null,
			prepareForReplay: vi.fn(),
			finishReplay: vi.fn(),
			setReplayTimestamp: vi.fn(),
			setActiveSite: vi.fn(),
			beginAgentTurn: vi.fn(),
			addUserMessage: vi.fn(),
			handleMessage: vi.fn(),
			setLoaderMessage: vi.fn(),
			showAgentQuestion: vi.fn(),
			endAgentTurn: vi.fn(),
		};
		const events: AiSessionEvent[] = [
			{
				type: 'user.message',
				timestamp: '2026-03-12T11:00:00.000Z',
				text: 'answer from ask_user',
				source: 'ask_user',
			},
			{
				type: 'user.message',
				timestamp: '2026-03-12T11:00:01.000Z',
				text: 'top-level prompt',
				source: 'prompt',
			},
			{
				type: 'turn.closed',
				timestamp: '2026-03-12T11:00:02.000Z',
				status: 'success',
			},
		];

		replaySessionHistory( ui as never, events );

		expect( ui.beginAgentTurn ).toHaveBeenCalledTimes( 1 );
		expect( ui.addUserMessage ).toHaveBeenCalledTimes( 1 );
		expect( ui.addUserMessage ).toHaveBeenCalledWith( 'top-level prompt' );
		expect( ui.endAgentTurn ).toHaveBeenCalledTimes( 1 );
	} );

	it( 'closes an open replay turn when turn.closed is missing', () => {
		const ui = {
			activeSite: null,
			prepareForReplay: vi.fn(),
			finishReplay: vi.fn(),
			setReplayTimestamp: vi.fn(),
			setActiveSite: vi.fn(),
			beginAgentTurn: vi.fn(),
			addUserMessage: vi.fn(),
			handleMessage: vi.fn(),
			setLoaderMessage: vi.fn(),
			showAgentQuestion: vi.fn(),
			endAgentTurn: vi.fn(),
		};
		const events: AiSessionEvent[] = [
			{
				type: 'user.message',
				timestamp: '2026-03-12T12:00:00.000Z',
				text: 'top-level prompt',
				source: 'prompt',
			},
			{
				type: 'sdk.message',
				timestamp: '2026-03-12T12:00:01.000Z',
				message: {
					type: 'assistant',
					message: {
						content: [
							{
								type: 'text',
								text: 'partial response',
							},
						],
					},
				} as SDKMessage,
			},
		];

		replaySessionHistory( ui as never, events );

		expect( ui.beginAgentTurn ).toHaveBeenCalledTimes( 1 );
		expect( ui.endAgentTurn ).toHaveBeenCalledTimes( 1 );
		expect( ui.finishReplay ).toHaveBeenCalledTimes( 1 );
	} );
} );
