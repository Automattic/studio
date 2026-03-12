import { beforeEach, describe, expect, it, vi } from 'vitest';
import yargs from 'yargs/yargs';
import { AiSessionRecorder, deleteAiSession, listAiSessions, loadAiSession } from 'cli/ai/sessions';
import { registerCommand as registerAiCommand } from 'cli/commands/ai';
import { registerCommand as registerAiSessionsDeleteCommand } from 'cli/commands/ai/sessions/delete';
import { registerCommand as registerAiSessionsListCommand } from 'cli/commands/ai/sessions/list';
import { registerCommand as registerAiSessionsResumeCommand } from 'cli/commands/ai/sessions/resume';
import { getAnthropicApiKey } from 'cli/lib/appdata';
import { StudioArgv } from 'cli/types';

const { reportErrorMock } = vi.hoisted( () => ( {
	reportErrorMock: vi.fn(),
} ) );

vi.mock( 'cli/lib/appdata', () => ( {
	getAnthropicApiKey: vi.fn(),
	saveAnthropicApiKey: vi.fn(),
} ) );

vi.mock( 'cli/logger', () => ( {
	Logger: class {
		reportStart = vi.fn();
		reportSuccess = vi.fn();
		reportError = reportErrorMock;
		reportProgress = vi.fn();
		reportWarning = vi.fn();
		reportKeyValuePair = vi.fn();
		spinner = {};
		currentAction = null;
	},
	LoggerError: class LoggerError extends Error {
		previousError?: Error;
		constructor( message: string, previousError?: unknown ) {
			super(
				previousError instanceof Error ? `${ message }: ${ previousError.message }` : message
			);
			this.name = 'LoggerError';
			if ( previousError instanceof Error ) {
				this.previousError = previousError;
			}
		}
	},
	setProgressCallback: vi.fn(),
} ) );

vi.mock( 'cli/ai/agent', () => {
	const emptyQuery = {
		interrupt: vi.fn().mockResolvedValue( undefined ),
		[ Symbol.asyncIterator ]() {
			return {
				next: async () => ( {
					done: true as const,
					value: undefined,
				} ),
			};
		},
	};

	return {
		AI_MODELS: {
			'claude-sonnet-4-6': 'Sonnet 4.6',
			'claude-opus-4-6': 'Opus 4.6',
		},
		DEFAULT_MODEL: 'claude-sonnet-4-6',
		startAiAgent: vi.fn( () => emptyQuery ),
	};
} );

vi.mock( 'cli/ai/ui', () => ( {
	AiChatUI: class {
		activeSite: { name: string; path: string; running: boolean } | null = null;
		currentModel = 'claude-sonnet-4-6';
		onSiteSelected: ( ( site: { name: string; path: string; running: boolean } ) => void ) | null =
			null;
		onInterrupt: ( () => void ) | null = null;
		start() {}
		stop() {}
		showWelcome() {}
		showInfo() {}
		showError() {}
		prepareForReplay() {}
		finishReplay() {}
		beginAgentTurn() {}
		endAgentTurn() {}
		setLoaderMessage() {}
		setActiveSite( site: { name: string; path: string; running: boolean } ) {
			this.activeSite = site;
		}
		addUserMessage() {}
		handleMessage() {
			return undefined;
		}
		showAgentQuestion() {}
		async askUser() {
			return {};
		}
		async waitForInput() {
			return '/exit';
		}
	},
	getToolDetail: ( _name: string, input: Record< string, unknown > ) =>
		typeof input.detail === 'string' ? input.detail : '',
} ) );

vi.mock( 'cli/ai/sessions', () => {
	class MockAiSessionRecorder {
		static create = vi.fn().mockResolvedValue( new MockAiSessionRecorder() );
		static open = vi.fn().mockResolvedValue( new MockAiSessionRecorder() );
		async recordToolProgress() {}
		async recordSiteSelected() {}
		async recordUserMessage() {}
		async recordAssistantMessage() {}
		async recordToolResult() {}
		async recordAgentQuestion() {}
		async recordTurnClosed() {}
		async recordAgentSessionId() {}
	}

	return {
		AiSessionRecorder: MockAiSessionRecorder,
		listAiSessions: vi.fn(),
		loadAiSession: vi.fn(),
		deleteAiSession: vi.fn(),
	};
} );

describe( 'CLI: studio ai sessions command', () => {
	beforeEach( () => {
		vi.clearAllMocks();
		vi.mocked( getAnthropicApiKey ).mockResolvedValue( 'test-api-key' );
		vi.spyOn( process, 'exit' ).mockImplementation( () => undefined as never );
	} );

	function buildParser(): StudioArgv {
		const parser = yargs( [] ).scriptName( 'studio' ).strict().exitProcess( false ) as StudioArgv;
		parser.command( 'ai', 'AI-powered WordPress assistant', ( aiYargs ) => {
			registerAiCommand( aiYargs as StudioArgv );
			aiYargs.command( 'sessions', 'Manage AI sessions', ( sessionsYargs ) => {
				sessionsYargs
					.option( 'path', {
						hidden: true,
					} )
					.option( 'session-persistence', {
						type: 'boolean',
						default: true,
						description: 'Record this AI chat session to disk',
					} );
				registerAiSessionsListCommand( sessionsYargs as StudioArgv );
				registerAiSessionsResumeCommand( sessionsYargs as StudioArgv );
				registerAiSessionsDeleteCommand( sessionsYargs as StudioArgv );
				sessionsYargs
					.version( false )
					.demandCommand( 1, 'You must provide a valid ai sessions command' );
			} );
			aiYargs.version( false );
		} );
		return parser;
	}

	it( 'records sessions by default when running studio ai', async () => {
		await buildParser().parseAsync( [ 'ai' ] );

		expect( ( AiSessionRecorder as typeof AiSessionRecorder ).create ).toHaveBeenCalledTimes( 1 );
	} );

	it( 'disables session recording with --no-session-persistence', async () => {
		await buildParser().parseAsync( [ 'ai', '--no-session-persistence' ] );

		expect( ( AiSessionRecorder as typeof AiSessionRecorder ).create ).not.toHaveBeenCalled();
		expect( ( AiSessionRecorder as typeof AiSessionRecorder ).open ).not.toHaveBeenCalled();
	} );

	it( 'resumes the latest session', async () => {
		vi.mocked( listAiSessions ).mockResolvedValue( [
			{
				id: 'session-latest',
				filePath: '/tmp/session-latest.jsonl',
				createdAt: '2026-03-11T11:00:00.000Z',
				updatedAt: '2026-03-11T11:00:00.000Z',
				linkedAgentSessionIds: [],
				eventCount: 1,
			},
			{
				id: 'session-older',
				filePath: '/tmp/session-older.jsonl',
				createdAt: '2026-03-10T11:00:00.000Z',
				updatedAt: '2026-03-10T11:00:00.000Z',
				linkedAgentSessionIds: [],
				eventCount: 1,
			},
		] );
		vi.mocked( loadAiSession ).mockResolvedValue( {
			summary: {
				id: 'session-latest',
				filePath: '/tmp/session-latest.jsonl',
				createdAt: '2026-03-11T11:00:00.000Z',
				updatedAt: '2026-03-11T11:00:00.000Z',
				linkedAgentSessionIds: [],
				eventCount: 1,
			},
			events: [],
		} );

		await buildParser().parseAsync( [ 'ai', 'sessions', 'resume', 'latest' ] );

		expect( loadAiSession ).toHaveBeenCalledWith( 'session-latest' );
		expect( ( AiSessionRecorder as typeof AiSessionRecorder ).open ).toHaveBeenCalledWith(
			expect.objectContaining( {
				sessionId: 'session-latest',
				filePath: '/tmp/session-latest.jsonl',
			} )
		);
		expect( process.exit ).toHaveBeenCalledWith( 0 );
	} );

	it( 'deletes the latest session', async () => {
		vi.mocked( listAiSessions ).mockResolvedValue( [
			{
				id: 'session-latest',
				filePath: '/tmp/session-latest.jsonl',
				createdAt: '2026-03-11T11:00:00.000Z',
				updatedAt: '2026-03-11T11:00:00.000Z',
				linkedAgentSessionIds: [],
				eventCount: 1,
			},
			{
				id: 'session-older',
				filePath: '/tmp/session-older.jsonl',
				createdAt: '2026-03-10T11:00:00.000Z',
				updatedAt: '2026-03-10T11:00:00.000Z',
				linkedAgentSessionIds: [],
				eventCount: 1,
			},
		] );
		vi.mocked( deleteAiSession ).mockResolvedValue( {
			id: 'session-latest',
			filePath: '/tmp/session-latest.jsonl',
			createdAt: '2026-03-11T11:00:00.000Z',
			updatedAt: '2026-03-11T11:00:00.000Z',
			linkedAgentSessionIds: [],
			eventCount: 1,
		} );

		await buildParser().parseAsync( [ 'ai', 'sessions', 'delete', 'latest' ] );

		expect( deleteAiSession ).toHaveBeenCalledWith( 'session-latest' );
		expect( console.log ).toHaveBeenCalledWith( expect.stringContaining( 'session-latest' ) );
	} );

	it( 'resumes latest without persistence when --no-session-persistence is set', async () => {
		vi.mocked( listAiSessions ).mockResolvedValue( [
			{
				id: 'session-latest',
				filePath: '/tmp/session-latest.jsonl',
				createdAt: '2026-03-11T11:00:00.000Z',
				updatedAt: '2026-03-11T11:00:00.000Z',
				linkedAgentSessionIds: [],
				eventCount: 1,
			},
		] );
		vi.mocked( loadAiSession ).mockResolvedValue( {
			summary: {
				id: 'session-latest',
				filePath: '/tmp/session-latest.jsonl',
				createdAt: '2026-03-11T11:00:00.000Z',
				updatedAt: '2026-03-11T11:00:00.000Z',
				linkedAgentSessionIds: [],
				eventCount: 1,
			},
			events: [],
		} );

		await buildParser().parseAsync( [
			'ai',
			'sessions',
			'resume',
			'latest',
			'--no-session-persistence',
		] );

		expect( loadAiSession ).toHaveBeenCalledWith( 'session-latest' );
		expect( ( AiSessionRecorder as typeof AiSessionRecorder ).open ).not.toHaveBeenCalled();
		expect( process.exit ).toHaveBeenCalledWith( 0 );
	} );

	it( 'reports an error when resuming latest and no sessions exist', async () => {
		vi.mocked( listAiSessions ).mockResolvedValue( [] );

		await buildParser().parseAsync( [ 'ai', 'sessions', 'resume', 'latest' ] );

		expect( loadAiSession ).not.toHaveBeenCalled();
		expect( reportErrorMock ).toHaveBeenCalled();
	} );

	it( 'reports an error when deleting latest and no sessions exist', async () => {
		vi.mocked( listAiSessions ).mockResolvedValue( [] );

		await buildParser().parseAsync( [ 'ai', 'sessions', 'delete', 'latest' ] );

		expect( deleteAiSession ).not.toHaveBeenCalled();
		expect( reportErrorMock ).toHaveBeenCalled();
	} );
} );
