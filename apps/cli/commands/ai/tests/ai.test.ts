import { deleteAiSession, listAiSessions, loadAiSession } from '@studio/common/ai/sessions/store';
import { __ } from '@wordpress/i18n';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import yargs from 'yargs/yargs';
import { AI_MODELS, DEFAULT_MODEL, startAiAgent } from 'cli/ai/agent';
import {
	resolveAiEnvironment,
	resolveInitialAiProvider,
	resolveUnavailableAiProvider,
} from 'cli/ai/auth';
import { AI_PROVIDERS } from 'cli/ai/providers';
import { AiSessionRecorder } from 'cli/ai/sessions/recorder';
import { registerCommand as registerAiCommand } from 'cli/commands/ai';
import { registerCommand as registerAiSessionsDeleteCommand } from 'cli/commands/ai/sessions/delete';
import { registerCommand as registerAiSessionsListCommand } from 'cli/commands/ai/sessions/list';
import { registerCommand as registerAiSessionsResumeCommand } from 'cli/commands/ai/sessions/resume';
import { readCliConfig } from 'cli/lib/cli-config/core';
import { setProgressCallback } from 'cli/logger';
import { StudioArgv } from 'cli/types';

const {
	askUserMock,
	clearTranscriptMock,
	showWelcomeMock,
	showErrorMock,
	showInfoMock,
	recordSessionClearedMock,
	recordSessionContextMock,
	recordSiteSelectedMock,
	recordUserMessageMock,
	addUserMessageMock,
	reportErrorMock,
	setLoaderMessageMock,
	waitForInputMock,
	activeSiteRef,
	latestUiRef,
} = vi.hoisted( () => ( {
	askUserMock: vi.fn(),
	clearTranscriptMock: vi.fn(),
	showWelcomeMock: vi.fn(),
	showErrorMock: vi.fn(),
	showInfoMock: vi.fn(),
	recordSessionClearedMock: vi.fn(),
	recordSessionContextMock: vi.fn(),
	recordSiteSelectedMock: vi.fn(),
	recordUserMessageMock: vi.fn(),
	addUserMessageMock: vi.fn(),
	reportErrorMock: vi.fn(),
	setLoaderMessageMock: vi.fn(),
	waitForInputMock: vi.fn(),
	activeSiteRef: {
		current: null as {
			name: string;
			path: string;
			running: boolean;
			remote?: boolean;
			url?: string;
			wpcomSiteId?: number;
		} | null,
	},
	latestUiRef: {
		current: null as { onInterrupt: ( () => void ) | null } | null,
	},
} ) );

vi.mock( 'cli/lib/cli-config/core', async () => {
	const actual =
		await vi.importActual< typeof import('cli/lib/cli-config/core') >( 'cli/lib/cli-config/core' );

	return {
		...actual,
		readCliConfig: vi.fn(),
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
		constructor() {
			latestUiRef.current = this;
		}
		get activeSite(): {
			name: string;
			path: string;
			running: boolean;
			remote?: boolean;
			url?: string;
			wpcomSiteId?: number;
		} | null {
			return activeSiteRef.current;
		}
		set activeSite(
			value: {
				name: string;
				path: string;
				running: boolean;
				remote?: boolean;
				url?: string;
				wpcomSiteId?: number;
			} | null
		) {
			activeSiteRef.current = value;
		}
		currentModel = 'claude-sonnet-4-6';
		onSiteSelected:
			| ( ( site: {
					name: string;
					path: string;
					running: boolean;
					remote?: boolean;
					url?: string;
					wpcomSiteId?: number;
			  } ) => void )
			| null = null;
		onInterrupt: ( () => void ) | null = null;
		start() {}
		stop() {}
		showWelcome() {
			showWelcomeMock();
		}
		showInfo( ...args: unknown[] ) {
			showInfoMock( ...args );
		}
		showError( ...args: unknown[] ) {
			showErrorMock( ...args );
		}
		showSuccess() {}
		showOnboarding() {}
		showCapabilities() {}
		setStatusMessage() {}
		prepareForReplay() {}
		finishReplay() {}
		beginAgentTurn() {}
		endAgentTurn() {}
		setLoaderMessage( ...args: unknown[] ) {
			setLoaderMessageMock( ...args );
		}
		setActiveSite( site: {
			name: string;
			path: string;
			running: boolean;
			remote?: boolean;
			url?: string;
			wpcomSiteId?: number;
		} ) {
			this.activeSite = site;
		}
		addUserMessage( ...args: unknown[] ) {
			addUserMessageMock( ...args );
		}
		clearTranscript() {
			clearTranscriptMock();
		}
		handleMessage() {
			return undefined;
		}
		hasErrorBeenSurfaced() {
			return false;
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
		static create = vi
			.fn()
			.mockResolvedValue( new MockAiSessionRecorder( 'mock-session-created' ) );
		static open = vi.fn( ( options: { sessionId: string } ) =>
			Promise.resolve( new MockAiSessionRecorder( options.sessionId ) )
		);
		readonly sessionId: string;
		constructor( sessionId: string = 'mock-session-created' ) {
			this.sessionId = sessionId;
		}
		async recordSdkMessage() {}
		async recordToolProgress() {}
		async recordSessionCleared( ...args: unknown[] ) {
			return recordSessionClearedMock( ...args );
		}
		async recordSessionContext( ...args: unknown[] ) {
			return recordSessionContextMock( ...args );
		}
		async recordSiteSelected( ...args: unknown[] ) {
			return recordSiteSelectedMock( ...args );
		}
		async recordUserMessage( ...args: unknown[] ) {
			return recordUserMessageMock( ...args );
		}
		async recordAgentQuestion() {}
		async recordTurnClosed() {}
		async recordAgentSessionId() {}
	}

	return {
		AiSessionRecorder: MockAiSessionRecorder,
	};
} );

vi.mock( '@studio/common/ai/sessions/store', () => ( {
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

describe( 'CLI: studio code sessions command', () => {
	beforeEach( () => {
		vi.clearAllMocks();
		activeSiteRef.current = null;
		latestUiRef.current = null;
		vi.mocked( readCliConfig ).mockResolvedValue( {
			sites: [],
			anthropicApiKey: 'test-api-key',
			aiProvider: 'anthropic-api-key',
		} as never );
		askUserMock.mockResolvedValue( {} );
		waitForInputMock.mockResolvedValue( '/exit' );
		vi.spyOn( process, 'exit' ).mockImplementation( () => undefined as never );
	} );

	function buildParser(): StudioArgv {
		const parser = yargs( [] ).scriptName( 'studio' ).strict().exitProcess( false ) as StudioArgv;
		parser.command( [ 'code', 'ai' ], __( 'AI agent for building WordPress' ), ( aiYargs ) => {
			registerAiCommand( aiYargs as StudioArgv );
			aiYargs.command( 'sessions', __( 'Manage code sessions' ), ( sessionsYargs ) => {
				sessionsYargs
					.option( 'path', {
						hidden: true,
					} )
					.option( 'session-persistence', {
						type: 'boolean',
						default: true,
						description: __( 'Record this code session to disk' ),
					} );
				registerAiSessionsListCommand( sessionsYargs as StudioArgv );
				registerAiSessionsResumeCommand( sessionsYargs as StudioArgv );
				registerAiSessionsDeleteCommand( sessionsYargs as StudioArgv );
				sessionsYargs
					.version( false )
					.demandCommand( 1, __( 'You must provide a valid code sessions command' ) );
			} );
			aiYargs.version( false );
		} );
		return parser;
	}

	it( 'does not record an empty session when running studio code and exiting immediately', async () => {
		await buildParser().parseAsync( [ 'ai' ] );

		expect( ( AiSessionRecorder as typeof AiSessionRecorder ).create ).not.toHaveBeenCalled();
	} );

	it( 'records sessions by default once a prompt is submitted', async () => {
		waitForInputMock.mockResolvedValueOnce( 'Hello' ).mockResolvedValueOnce( '/exit' );

		await buildParser().parseAsync( [ 'ai' ] );

		expect( ( AiSessionRecorder as typeof AiSessionRecorder ).create ).toHaveBeenCalledTimes( 1 );
	} );

	it( 'passes progress update signals through to the loader', async () => {
		waitForInputMock.mockResolvedValueOnce( 'Hello' ).mockResolvedValueOnce( '/exit' );

		await buildParser().parseAsync( [ 'ai' ] );

		const progressCallback = vi.mocked( setProgressCallback ).mock.calls.at( -1 )?.[ 0 ];
		progressCallback?.( 'Applying changes… (75%)', true );

		expect( setLoaderMessageMock ).toHaveBeenCalledWith( 'Applying changes… (75%)', true );
	} );

	it( 'does not show the server retry prompt when the user interrupts a turn', async () => {
		const interruptMock = vi.fn().mockResolvedValue( undefined );
		waitForInputMock.mockResolvedValueOnce( 'Build a site' ).mockResolvedValueOnce( '/exit' );
		vi.mocked( startAiAgent ).mockReturnValueOnce( {
			interrupt: interruptMock,
			return: vi.fn().mockResolvedValue( { done: true, value: undefined } ),
			[ Symbol.asyncIterator ]() {
				return {
					next: async () => {
						latestUiRef.current?.onInterrupt?.();
						throw new Error( 'Query closed' );
					},
				};
			},
		} as never );

		await buildParser().parseAsync( [ 'ai' ] );

		expect( interruptMock ).toHaveBeenCalledTimes( 1 );
		expect( showErrorMock ).not.toHaveBeenCalled();
		expect( askUserMock ).not.toHaveBeenCalled();
	} );

	it( 'runs the next prompt directly after an interrupted turn', async () => {
		const firstInterruptMock = vi.fn().mockResolvedValue( undefined );
		const secondInterruptMock = vi.fn().mockResolvedValue( undefined );
		waitForInputMock
			.mockResolvedValueOnce( 'Build a site' )
			.mockResolvedValueOnce( 'Try a different layout' )
			.mockResolvedValueOnce( '/exit' );
		vi.mocked( startAiAgent )
			.mockReturnValueOnce( {
				interrupt: firstInterruptMock,
				[ Symbol.asyncIterator ]() {
					return {
						next: async () => {
							latestUiRef.current?.onInterrupt?.();
							return new Promise( () => undefined );
						},
					};
				},
			} as never )
			.mockReturnValueOnce( {
				interrupt: secondInterruptMock,
				return: vi.fn().mockResolvedValue( { done: true, value: undefined } ),
				[ Symbol.asyncIterator ]() {
					let emitted = false;
					return {
						next: async () => {
							if ( ! emitted ) {
								emitted = true;
								return {
									done: false as const,
									value: {
										type: 'result' as const,
										subtype: 'success' as const,
										session_id: 'next-session',
										num_turns: 1,
										total_cost_usd: 0,
									},
								};
							}
							return { done: true as const, value: undefined };
						},
					};
				},
			} as never );

		await buildParser().parseAsync( [ 'ai' ] );

		expect( firstInterruptMock ).toHaveBeenCalledTimes( 1 );
		expect( startAiAgent ).toHaveBeenCalledTimes( 2 );
		expect( startAiAgent ).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining( {
				prompt: 'Try a different layout',
			} )
		);
		expect( secondInterruptMock ).not.toHaveBeenCalled();
	} );

	it( 'persists selected model before the first prompt is sent', async () => {
		const alternateModel = AI_MODELS.find( ( model ) => model.id !== DEFAULT_MODEL );
		expect( alternateModel ).toBeDefined();
		const { id: selectedModelId, label: selectedModelLabel } = alternateModel!;

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
				activeEnvironment: 'local',
				eventCount: 1,
			},
			{
				id: 'session-older',
				filePath: '/tmp/session-older.jsonl',
				createdAt: '2026-03-10T11:00:00.000Z',
				updatedAt: '2026-03-10T11:00:00.000Z',
				linkedAgentSessionIds: [],
				activeEnvironment: 'local',
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
				activeEnvironment: 'local',
				eventCount: 1,
			},
			events: [],
		} );

		await buildParser().parseAsync( [ 'ai', 'sessions', 'resume', 'latest' ] );

		expect( loadAiSession ).toHaveBeenCalledWith( expect.any( String ), 'session-latest' );
		expect( ( AiSessionRecorder as typeof AiSessionRecorder ).open ).not.toHaveBeenCalled();
		expect( process.exit ).toHaveBeenCalledWith( 0 );
	} );

	it( 'persists the display message when resuming with a hidden full message', async () => {
		vi.mocked( loadAiSession ).mockResolvedValue( {
			summary: {
				id: 'session-id',
				filePath: '/tmp/session-id.jsonl',
				createdAt: '2026-03-11T11:00:00.000Z',
				updatedAt: '2026-03-11T11:00:00.000Z',
				linkedAgentSessionIds: [],
				activeEnvironment: 'local',
				eventCount: 1,
			},
			events: [],
		} );

		await buildParser().parseAsync( [
			'ai',
			'sessions',
			'resume',
			'session-id',
			'Full annotation prompt',
			'--json',
			'--display-message',
			'2 annotations submitted',
		] );

		expect( startAiAgent ).toHaveBeenCalledWith(
			expect.objectContaining( {
				prompt: 'Full annotation prompt',
			} )
		);
		expect( recordUserMessageMock ).toHaveBeenCalledWith(
			expect.objectContaining( {
				text: '2 annotations submitted',
				source: 'prompt',
			} )
		);
	} );

	it( 'deletes the latest session', async () => {
		vi.mocked( listAiSessions ).mockResolvedValue( [
			{
				id: 'session-latest',
				filePath: '/tmp/session-latest.jsonl',
				createdAt: '2026-03-11T11:00:00.000Z',
				updatedAt: '2026-03-11T11:00:00.000Z',
				linkedAgentSessionIds: [],
				activeEnvironment: 'local',
				eventCount: 1,
			},
			{
				id: 'session-older',
				filePath: '/tmp/session-older.jsonl',
				createdAt: '2026-03-10T11:00:00.000Z',
				updatedAt: '2026-03-10T11:00:00.000Z',
				linkedAgentSessionIds: [],
				activeEnvironment: 'local',
				eventCount: 1,
			},
		] );
		vi.mocked( deleteAiSession ).mockResolvedValue( {
			id: 'session-latest',
			filePath: '/tmp/session-latest.jsonl',
			createdAt: '2026-03-11T11:00:00.000Z',
			updatedAt: '2026-03-11T11:00:00.000Z',
			linkedAgentSessionIds: [],
			activeEnvironment: 'local',
			eventCount: 1,
		} );

		await buildParser().parseAsync( [ 'ai', 'sessions', 'delete', 'latest' ] );

		expect( deleteAiSession ).toHaveBeenCalledWith( expect.any( String ), 'session-latest' );
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
				activeEnvironment: 'local',
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
				activeEnvironment: 'local',
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

		expect( loadAiSession ).toHaveBeenCalledWith( expect.any( String ), 'session-latest' );
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

	it( '/clear resets the session, clears the transcript, and re-emits context', async () => {
		waitForInputMock.mockResolvedValueOnce( '/clear' ).mockResolvedValueOnce( '/exit' );

		await buildParser().parseAsync( [ 'ai' ] );

		expect( recordSessionClearedMock ).toHaveBeenCalledTimes( 1 );
		expect( clearTranscriptMock ).toHaveBeenCalledTimes( 1 );

		// Context must be re-emitted AFTER the cleared event.
		expect( recordSessionContextMock.mock.invocationCallOrder[ 0 ] ).toBeGreaterThan(
			recordSessionClearedMock.mock.invocationCallOrder[ 0 ]
		);

		// showWelcome must be called after clearTranscript.
		// showWelcome is also called at startup, so index [1] is the /clear invocation.
		expect( showWelcomeMock ).toHaveBeenCalledTimes( 2 );
		expect( showWelcomeMock.mock.invocationCallOrder[ 1 ] ).toBeGreaterThan(
			clearTranscriptMock.mock.invocationCallOrder[ 0 ]
		);

		expect( showInfoMock ).toHaveBeenCalledWith( 'Conversation cleared' );

		// startAiAgent should never have been called (no prompt was submitted).
		expect( startAiAgent ).not.toHaveBeenCalled();
	} );

	it( '/clear without an active site does not re-emit a site event', async () => {
		waitForInputMock.mockResolvedValueOnce( '/clear' ).mockResolvedValueOnce( '/exit' );

		await buildParser().parseAsync( [ 'ai' ] );

		expect( recordSessionClearedMock ).toHaveBeenCalledTimes( 1 );
		expect( recordSiteSelectedMock ).not.toHaveBeenCalled();
		expect( showWelcomeMock ).toHaveBeenCalled();
	} );

	it( '/clear with an active site re-emits the site event after the clear marker', async () => {
		activeSiteRef.current = {
			name: 'Test Site',
			path: '/tmp/test-site',
			running: false,
		};

		waitForInputMock.mockResolvedValueOnce( '/clear' ).mockResolvedValueOnce( '/exit' );

		await buildParser().parseAsync( [ 'ai' ] );

		expect( recordSessionClearedMock ).toHaveBeenCalledTimes( 1 );
		expect( recordSiteSelectedMock ).toHaveBeenCalledTimes( 1 );
		expect( recordSiteSelectedMock ).toHaveBeenCalledWith(
			expect.objectContaining( {
				name: 'Test Site',
				path: '/tmp/test-site',
			} )
		);
		expect( recordSiteSelectedMock.mock.invocationCallOrder[ 0 ] ).toBeGreaterThan(
			recordSessionClearedMock.mock.invocationCallOrder[ 0 ]
		);
		expect( showWelcomeMock ).toHaveBeenCalled();
	} );

	it( '/clear with an active remote site re-emits the remote site fields', async () => {
		activeSiteRef.current = {
			name: 'My WPCOM Site',
			path: '',
			running: false,
			remote: true,
			url: 'https://mywpcomsite.wordpress.com',
			wpcomSiteId: 12345,
		};

		waitForInputMock.mockResolvedValueOnce( '/clear' ).mockResolvedValueOnce( '/exit' );

		await buildParser().parseAsync( [ 'ai' ] );

		expect( recordSiteSelectedMock ).toHaveBeenCalledTimes( 1 );
		expect( recordSiteSelectedMock ).toHaveBeenCalledWith(
			expect.objectContaining( {
				name: 'My WPCOM Site',
				remote: true,
				url: 'https://mywpcomsite.wordpress.com',
				wpcomSiteId: 12345,
			} )
		);
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
				activeEnvironment: 'local',
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
				activeEnvironment: 'local',
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

		expect( resolveAiEnvironment ).toHaveBeenCalledWith( 'anthropic-api-key', {
			sessionId: 'session-latest',
		} );
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

describe( 'CLI: studio code --json mode', () => {
	let stdoutChunks: string[];
	let originalWrite: typeof process.stdout.write;

	beforeEach( () => {
		vi.clearAllMocks();
		vi.mocked( readCliConfig ).mockResolvedValue( {
			sites: [],
			anthropicApiKey: 'test-api-key',
			aiProvider: 'anthropic-api-key',
		} as never );
		vi.spyOn( process, 'exit' ).mockImplementation( () => undefined as never );

		stdoutChunks = [];
		originalWrite = process.stdout.write;
		process.stdout.write = ( chunk: string | Uint8Array ) => {
			stdoutChunks.push( typeof chunk === 'string' ? chunk : new TextDecoder().decode( chunk ) );
			return true;
		};
	} );

	afterEach( () => {
		process.stdout.write = originalWrite;
		process.exitCode = undefined;
	} );

	function buildParser(): StudioArgv {
		const parser = yargs( [] ).scriptName( 'studio' ).strict().exitProcess( false ) as StudioArgv;
		parser.command( [ 'code', 'ai' ], __( 'AI agent for building WordPress' ), ( aiYargs ) => {
			registerAiCommand( aiYargs as StudioArgv );
			aiYargs.version( false );
		} );
		return parser;
	}

	function parseNdjsonEvents(): Array< Record< string, unknown > > {
		return stdoutChunks
			.join( '' )
			.split( '\n' )
			.filter( ( line ) => line.trim() )
			.map( ( line ) => JSON.parse( line ) );
	}

	it( 'runs a single turn and emits turn.started and turn.completed events', async () => {
		const resultMessage = {
			type: 'result' as const,
			subtype: 'success' as const,
			session_id: 'json-session-1',
			num_turns: 1,
			total_cost_usd: 0.001,
		};
		vi.mocked( startAiAgent ).mockReturnValueOnce( {
			interrupt: vi.fn().mockResolvedValue( undefined ),
			[ Symbol.asyncIterator ]() {
				let emitted = false;
				return {
					next: async () => {
						if ( ! emitted ) {
							emitted = true;
							return { done: false as const, value: resultMessage };
						}
						return { done: true as const, value: undefined };
					},
				};
			},
		} as never );

		await buildParser().parseAsync( [ 'ai', 'hello world', '--json' ] );

		const events = parseNdjsonEvents();
		expect( events[ 0 ] ).toMatchObject( { type: 'turn.started' } );
		expect( events[ events.length - 1 ] ).toMatchObject( {
			type: 'turn.completed',
			status: 'success',
		} );
		expect( process.exitCode ).not.toBe( 1 );
	} );

	it( 'streams SDK messages as NDJSON', async () => {
		const resultMessage = {
			type: 'result' as const,
			subtype: 'success' as const,
			session_id: 'test-session-123',
			num_turns: 3,
			total_cost_usd: 0.005,
		};

		vi.mocked( startAiAgent ).mockReturnValueOnce( {
			interrupt: vi.fn().mockResolvedValue( undefined ),
			[ Symbol.asyncIterator ]() {
				let emitted = false;
				return {
					next: async () => {
						if ( ! emitted ) {
							emitted = true;
							return { done: false as const, value: resultMessage };
						}
						return { done: true as const, value: undefined };
					},
				};
			},
		} as never );

		await buildParser().parseAsync( [ 'ai', 'test prompt', '--json' ] );

		const events = parseNdjsonEvents();
		const messageEvent = events.find( ( e ) => e.type === 'message' );
		expect( messageEvent ).toBeDefined();
		expect( ( messageEvent as Record< string, unknown > ).message ).toMatchObject( {
			type: 'result',
			session_id: 'test-session-123',
		} );

		const completedEvent = events.find( ( e ) => e.type === 'turn.completed' );
		expect( completedEvent ).toMatchObject( {
			type: 'turn.completed',
			sessionId: 'test-session-123',
			status: 'success',
		} );
	} );

	it( 'emits error event and exits with code 1 on agent failure', async () => {
		vi.mocked( startAiAgent ).mockReturnValueOnce( {
			interrupt: vi.fn().mockResolvedValue( undefined ),
			[ Symbol.asyncIterator ]() {
				return {
					next: async () => {
						throw new Error( 'API connection failed' );
					},
				};
			},
		} as never );

		await buildParser().parseAsync( [ 'ai', 'test prompt', '--json' ] );

		const events = parseNdjsonEvents();
		const errorEvent = events.find( ( e ) => e.type === 'error' );
		expect( errorEvent ).toMatchObject( {
			type: 'error',
			message: 'API connection failed',
		} );

		const completedEvent = events.find( ( e ) => e.type === 'turn.completed' );
		expect( completedEvent ).toMatchObject( {
			type: 'turn.completed',
			status: 'error',
		} );
		expect( process.exitCode ).toBe( 1 );
	} );
} );
