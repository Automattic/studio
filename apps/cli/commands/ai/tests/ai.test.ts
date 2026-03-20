import { __ } from '@wordpress/i18n';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import yargs from 'yargs/yargs';
import { AI_MODELS, DEFAULT_MODEL, startAiAgent } from 'cli/ai/agent';
import {
	resolveAiEnvironment,
	resolveInitialAiProvider,
	resolveUnavailableAiProvider,
} from 'cli/ai/auth';
import { AI_PROVIDERS } from 'cli/ai/providers';
import { AiSessionRecorder } from 'cli/ai/sessions/recorder';
import { deleteAiSession, listAiSessions, loadAiSession } from 'cli/ai/sessions/store';
import { registerCommand as registerAiCommand } from 'cli/commands/ai';
import { registerCommand as registerAiSessionsDeleteCommand } from 'cli/commands/ai/sessions/delete';
import { registerCommand as registerAiSessionsListCommand } from 'cli/commands/ai/sessions/list';
import { registerCommand as registerAiSessionsResumeCommand } from 'cli/commands/ai/sessions/resume';
import { getAnthropicApiKey } from 'cli/lib/appdata';
import { StudioArgv } from 'cli/types';

const { askUserMock, recordSessionContextMock, reportErrorMock, waitForInputMock } = vi.hoisted(
	() => ( {
		askUserMock: vi.fn(),
		recordSessionContextMock: vi.fn(),
		reportErrorMock: vi.fn(),
		waitForInputMock: vi.fn(),
	} )
);

vi.mock( 'cli/lib/appdata', async () => {
	const actual = await vi.importActual< typeof import('cli/lib/appdata') >( 'cli/lib/appdata' );

	return {
		...actual,
		getAnthropicApiKey: vi.fn(),
		getAuthToken: vi.fn().mockResolvedValue( {
			displayName: 'Test User',
			email: 'test@example.com',
		} ),
		saveAnthropicApiKey: vi.fn(),
	};
} );

vi.mock( 'cli/ai/auth', () => ( {
	getAvailableAiProviders: vi.fn().mockResolvedValue( [ 'anthropic-api-key', 'wpcom' ] ),
	isAiProviderReady: vi.fn().mockResolvedValue( true ),
	prepareAiProvider: vi.fn().mockResolvedValue( undefined ),
	resolveAiEnvironment: vi.fn().mockResolvedValue( {} ),
	resolveInitialAiProvider: vi.fn().mockResolvedValue( 'anthropic-api-key' ),
	resolveUnavailableAiProvider: vi.fn().mockResolvedValue( undefined ),
	saveSelectedAiProvider: vi.fn().mockResolvedValue( undefined ),
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

vi.mock( 'cli/ai/agent', async () => {
	const actual = await vi.importActual< typeof import('cli/ai/agent') >( 'cli/ai/agent' );
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
		...actual,
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
		setStatusMessage() {}
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
			return askUserMock();
		}
		async waitForInput() {
			return waitForInputMock();
		}
	},
	getToolDetail: ( _name: string, input: Record< string, unknown > ) =>
		typeof input.detail === 'string' ? input.detail : '',
} ) );

vi.mock( 'cli/ai/sessions/recorder', () => {
	class MockAiSessionRecorder {
		static create = vi.fn().mockResolvedValue( new MockAiSessionRecorder() );
		static open = vi.fn().mockResolvedValue( new MockAiSessionRecorder() );
		async recordSdkMessage() {}
		async recordToolProgress() {}
		async recordSessionContext( ...args: unknown[] ) {
			return recordSessionContextMock( ...args );
		}
		async recordSiteSelected() {}
		async recordUserMessage() {}
		async recordAgentQuestion() {}
		async recordTurnClosed() {}
		async recordAgentSessionId() {}
	}

	return {
		AiSessionRecorder: MockAiSessionRecorder,
	};
} );

vi.mock( 'cli/ai/sessions/store', () => ( {
	listAiSessions: vi.fn(),
	loadAiSession: vi.fn(),
	deleteAiSession: vi.fn(),
} ) );

vi.mock( 'cli/ai/sessions/replay', () => ( {
	replaySessionHistory: vi.fn(),
} ) );

vi.mock( 'cli/commands/auth/login', () => ( {
	runCommand: vi.fn().mockResolvedValue( undefined ),
} ) );

vi.mock( 'cli/commands/auth/logout', () => ( {
	runCommand: vi.fn().mockResolvedValue( undefined ),
} ) );

describe( 'CLI: studio ai sessions command', () => {
	beforeEach( () => {
		vi.clearAllMocks();
		vi.mocked( getAnthropicApiKey ).mockResolvedValue( 'test-api-key' );
		askUserMock.mockResolvedValue( {} );
		waitForInputMock.mockResolvedValue( '/exit' );
		vi.spyOn( process, 'exit' ).mockImplementation( () => undefined as never );
	} );

	function buildParser(): StudioArgv {
		const parser = yargs( [] ).scriptName( 'studio' ).strict().exitProcess( false ) as StudioArgv;
		parser.command( 'ai', __( 'AI-powered WordPress assistant' ), ( aiYargs ) => {
			registerAiCommand( aiYargs as StudioArgv );
			aiYargs.command( 'sessions', __( 'Manage AI sessions' ), ( sessionsYargs ) => {
				sessionsYargs
					.option( 'path', {
						hidden: true,
					} )
					.option( 'session-persistence', {
						type: 'boolean',
						default: true,
						description: __( 'Record this AI chat session to disk' ),
					} );
				registerAiSessionsListCommand( sessionsYargs as StudioArgv );
				registerAiSessionsResumeCommand( sessionsYargs as StudioArgv );
				registerAiSessionsDeleteCommand( sessionsYargs as StudioArgv );
				sessionsYargs
					.version( false )
					.demandCommand( 1, __( 'You must provide a valid ai sessions command' ) );
			} );
			aiYargs.version( false );
		} );
		return parser;
	}

	it( 'does not record an empty session when running studio ai and exiting immediately', async () => {
		await buildParser().parseAsync( [ 'ai' ] );

		expect( ( AiSessionRecorder as typeof AiSessionRecorder ).create ).not.toHaveBeenCalled();
	} );

	it( 'records sessions by default once a prompt is submitted', async () => {
		waitForInputMock.mockResolvedValueOnce( 'Hello' ).mockResolvedValueOnce( '/exit' );

		await buildParser().parseAsync( [ 'ai' ] );

		expect( ( AiSessionRecorder as typeof AiSessionRecorder ).create ).toHaveBeenCalledTimes( 1 );
	} );

	it( 'persists selected model before the first prompt is sent', async () => {
		const alternateModel = ( Object.entries( AI_MODELS ) as [ string, string ][] ).find(
			( [ modelId ] ) => modelId !== DEFAULT_MODEL
		);
		expect( alternateModel ).toBeDefined();
		const [ selectedModelId, selectedModelLabel ] = alternateModel!;

		waitForInputMock.mockResolvedValueOnce( '/model' ).mockResolvedValueOnce( '/exit' );
		askUserMock.mockResolvedValueOnce( {
			'Select a model': selectedModelLabel,
		} );

		await buildParser().parseAsync( [ 'ai' ] );

		expect( ( AiSessionRecorder as typeof AiSessionRecorder ).create ).toHaveBeenCalledTimes( 1 );
		expect( recordSessionContextMock ).toHaveBeenCalledWith( {
			provider: 'anthropic-api-key',
			model: selectedModelId,
		} );
		expect( startAiAgent ).not.toHaveBeenCalled();
	} );

	it( 'persists selected provider before the first prompt is sent', async () => {
		waitForInputMock.mockResolvedValueOnce( '/provider' ).mockResolvedValueOnce( '/exit' );
		askUserMock.mockResolvedValueOnce( {
			'Select an AI provider': AI_PROVIDERS.wpcom,
		} );

		await buildParser().parseAsync( [ 'ai' ] );

		expect( ( AiSessionRecorder as typeof AiSessionRecorder ).create ).toHaveBeenCalledTimes( 1 );
		expect( recordSessionContextMock ).toHaveBeenCalledWith( {
			provider: 'wpcom',
			model: DEFAULT_MODEL,
		} );
		expect( startAiAgent ).not.toHaveBeenCalled();
	} );

	it( 'persists auto-switched provider after logout before any prompt is sent', async () => {
		vi.mocked( resolveUnavailableAiProvider ).mockResolvedValueOnce( 'wpcom' );
		waitForInputMock.mockResolvedValueOnce( '/logout' ).mockResolvedValueOnce( '/exit' );

		await buildParser().parseAsync( [ 'ai' ] );

		expect( ( AiSessionRecorder as typeof AiSessionRecorder ).create ).toHaveBeenCalledTimes( 1 );
		expect( recordSessionContextMock ).toHaveBeenCalledWith( {
			provider: 'wpcom',
			model: DEFAULT_MODEL,
		} );
		expect( startAiAgent ).not.toHaveBeenCalled();
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
		expect( ( AiSessionRecorder as typeof AiSessionRecorder ).open ).not.toHaveBeenCalled();
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

	it( 'restores provider, model, and resume session id from session events', async () => {
		vi.mocked( resolveInitialAiProvider ).mockResolvedValue( 'wpcom' );
		waitForInputMock.mockResolvedValueOnce( 'Continue the task' ).mockResolvedValueOnce( '/exit' );

		vi.mocked( listAiSessions ).mockResolvedValue( [
			{
				id: 'session-latest',
				filePath: '/tmp/session-latest.jsonl',
				createdAt: '2026-03-11T11:00:00.000Z',
				updatedAt: '2026-03-11T11:00:00.000Z',
				linkedAgentSessionIds: [],
				eventCount: 2,
			},
		] );
		vi.mocked( loadAiSession ).mockResolvedValue( {
			summary: {
				id: 'session-latest',
				filePath: '/tmp/session-latest.jsonl',
				createdAt: '2026-03-11T11:00:00.000Z',
				updatedAt: '2026-03-11T11:00:00.000Z',
				linkedAgentSessionIds: [],
				eventCount: 2,
			},
			events: [
				{
					type: 'session.context',
					timestamp: '2026-03-11T11:00:00.000Z',
					provider: 'anthropic-api-key',
					model: 'claude-opus-4-6',
				},
				{
					type: 'sdk.message',
					timestamp: '2026-03-11T11:00:01.000Z',
					message: {
						type: 'assistant',
						session_id: 'session-from-sdk-message',
						message: {
							content: [],
						},
					},
				},
			],
		} );

		await buildParser().parseAsync( [ 'ai', 'sessions', 'resume', 'latest' ] );

		expect( resolveAiEnvironment ).toHaveBeenCalledWith( 'anthropic-api-key' );
		expect( ( AiSessionRecorder as typeof AiSessionRecorder ).open ).toHaveBeenCalledWith(
			expect.objectContaining( {
				sessionId: 'session-latest',
				filePath: '/tmp/session-latest.jsonl',
			} )
		);
		expect( startAiAgent ).toHaveBeenCalledWith(
			expect.objectContaining( {
				model: 'claude-opus-4-6',
				resume: 'session-from-sdk-message',
			} )
		);
		expect( process.exit ).toHaveBeenCalledWith( 0 );
	} );
} );
