import { readAnthropicApiKey, readSelectedAiProvider } from '@studio/common/ai/settings-store';
import { readAuthToken } from '@studio/common/lib/shared-config';
import { vi, type Mock } from 'vitest';
import { resolveInitialAiProvider, saveSelectedAiProvider } from 'cli/ai/auth';
import { JsonAdapter } from 'cli/ai/output-adapter';
import { runStudioAgentTurn } from 'cli/ai/runtimes/pi';
import {
	createStudioSession,
	listStudioSessionFiles,
	openStudioSession,
} from 'cli/ai/sessions/pi-session';
import { findSiteByFolder } from 'cli/lib/cli-config/sites';
import { disconnectFromDaemon } from 'cli/lib/daemon-client';
import { isSiteRunning } from 'cli/lib/site-utils';
import { recordTracksEvent, TRACKS_EVENTS } from 'cli/lib/tracks';
import { runCommand } from '../index';

vi.mock( '@studio/common/lib/shared-config', () => ( {
	readAuthToken: vi.fn(),
} ) );
vi.mock( 'cli/lib/tracks', async ( importActual ) => {
	const actual = await importActual< typeof import('cli/lib/tracks') >();
	return { ...actual, recordTracksEvent: vi.fn() };
} );
vi.mock( 'cli/ai/auth', () => ( {
	resolveInitialAiProvider: vi.fn(),
	saveSelectedAiProvider: vi.fn(),
	getAvailableAiProviders: vi.fn( () => [ 'wpcom' ] ),
	isAiProviderReady: vi.fn(),
	prepareAiProvider: vi.fn(),
	resolveAiEnvironment: vi.fn(),
	resolveUnavailableAiProvider: vi.fn(),
} ) );
vi.mock( 'cli/ai/providers', () => ( {
	AI_PROVIDERS: { wpcom: 'WordPress.com', 'anthropic-api-key': 'Anthropic · API key' },
	getAiProviderDefinition: () => ( {
		supportsModel: () => true,
		defaultModel: 'claude-default',
	} ),
} ) );
vi.mock( '@studio/common/ai/settings-store', () => ( {
	readAnthropicApiKey: vi.fn(),
	readSelectedAiProvider: vi.fn().mockResolvedValue( 'wpcom' ),
} ) );
vi.mock( 'cli/lib/cli-config/sites', () => ( {
	findSiteByFolder: vi.fn(),
} ) );
vi.mock( 'cli/lib/site-utils', () => ( {
	isSiteRunning: vi.fn(),
} ) );
vi.mock( 'cli/lib/daemon-client', () => ( {
	disconnectFromDaemon: vi.fn().mockResolvedValue( undefined ),
} ) );
vi.mock( 'cli/ai/sessions/context', () => ( {
	resolveResumeSessionContext: () => ( { provider: undefined, model: undefined } ),
} ) );
vi.mock( 'cli/ai/sessions/pi-session', () => ( {
	createStudioSession: vi.fn(),
	openStudioSession: vi.fn(),
	listStudioSessionFiles: vi.fn(),
} ) );
vi.mock( 'cli/ai/sessions/replay', () => ( { replaySessionHistory: vi.fn() } ) );
vi.mock( '@studio/common/lib/well-known-paths', async ( importOriginal ) => ( {
	...( await importOriginal< typeof import('@studio/common/lib/well-known-paths') >() ),
	getSessionsDirectory: vi.fn(),
} ) );
vi.mock( 'cli/ai/runtimes/pi', () => ( {
	// A completed turn so the JSON single-turn path returns instead of looping.
	runStudioAgentTurn: vi.fn( () => ( { result: Promise.resolve(), interrupt: vi.fn() } ) ),
} ) );
vi.mock( 'cli/ai/slash-commands', () => ( { getActiveSlashCommands: vi.fn( () => [] ) } ) );
vi.mock( 'cli/ai/browser-utils', () => ( { closeSharedBrowser: vi.fn() } ) );
vi.mock( 'cli/ai/chat-artifacts', () => ( { setChatArtifactCallback: vi.fn() } ) );
vi.mock( 'cli/ai/site-selection', () => ( { setLocalSiteSelectedCallback: vi.fn() } ) );
vi.mock( 'cli/ai/daemon-status-poll', () => ( {
	startDaemonStatusPolling: vi.fn( () => vi.fn() ),
} ) );
vi.mock( 'cli/commands/auth/login', () => ( { runCommand: vi.fn() } ) );
vi.mock( 'cli/ai/ui', () => ( { AiChatUI: class AiChatUI {} } ) );
vi.mock( 'cli/logger', () => ( {
	Logger: class {},
	LoggerError: class LoggerError extends Error {},
	setProgressCallback: vi.fn(),
} ) );

describe( 'AI runCommand — Desktop (JSON mode) provider default', () => {
	let stdoutSpy: ReturnType< typeof vi.spyOn >;

	beforeEach( () => {
		vi.clearAllMocks();
		( createStudioSession as Mock ).mockResolvedValue( {
			appendCustomEntry: vi.fn( () => 'entry-id' ),
			getSessionId: () => 'session-id',
			getEntries: () => [],
		} );
		( readAuthToken as Mock ).mockResolvedValue( null );
		// Silence the NDJSON the adapter writes to stdout.
		stdoutSpy = vi.spyOn( process.stdout, 'write' ).mockImplementation( () => true );
	} );

	afterEach( () => {
		stdoutSpy.mockRestore();
	} );

	it( 'defaults to the wpcom provider on first run when none is configured', async () => {
		( readSelectedAiProvider as Mock ).mockResolvedValue( undefined );
		( resolveInitialAiProvider as Mock ).mockResolvedValue( 'wpcom' );

		await runCommand( { adapter: new JsonAdapter(), initialMessage: 'hello' } );

		expect( runStudioAgentTurn ).toHaveBeenCalled();
		expect( saveSelectedAiProvider ).toHaveBeenCalledTimes( 1 );
		expect( saveSelectedAiProvider ).toHaveBeenCalledWith( 'wpcom' );
	} );

	it( 'does not override an already-configured provider', async () => {
		( readSelectedAiProvider as Mock ).mockResolvedValue( 'anthropic-api-key' );
		( readAnthropicApiKey as Mock ).mockResolvedValue( 'saved-key' );
		( resolveInitialAiProvider as Mock ).mockResolvedValue( 'anthropic-api-key' );

		await runCommand( { adapter: new JsonAdapter(), initialMessage: 'hello' } );

		expect( runStudioAgentTurn ).toHaveBeenCalled();
		expect( saveSelectedAiProvider ).not.toHaveBeenCalled();
	} );
} );

describe( 'AI runCommand — resume by id restores session model', () => {
	let stdoutSpy: ReturnType< typeof vi.spyOn >;

	beforeEach( () => {
		vi.clearAllMocks();
		( readAuthToken as Mock ).mockResolvedValue( null );
		( readSelectedAiProvider as Mock ).mockResolvedValue( 'wpcom' );
		( resolveInitialAiProvider as Mock ).mockResolvedValue( 'wpcom' );
		stdoutSpy = vi.spyOn( process.stdout, 'write' ).mockImplementation( () => true );
	} );

	afterEach( () => {
		stdoutSpy.mockRestore();
	} );

	it( 'uses the model recorded in the session rather than DEFAULT_MODEL', async () => {
		// Build a minimal session whose entries record a model_change to a
		// non-default model — the same shape that `resolveSessionModel` reads.
		const sessionEntries = [
			{
				type: 'model_change',
				id: 'e1',
				parentId: null,
				timestamp: '2024-01-01T00:00:00Z',
				modelId: 'claude-opus-5',
			},
		];
		const mockSm = {
			appendCustomEntry: vi.fn( () => 'entry-id' ),
			getSessionId: () => 'resume-id-123',
			getEntries: () => sessionEntries,
		};

		( listStudioSessionFiles as Mock ).mockResolvedValue( [ '/sessions/session-1.jsonl' ] );
		( openStudioSession as Mock ).mockResolvedValue( mockSm );

		await runCommand( {
			adapter: new JsonAdapter(),
			initialMessage: 'hello',
			resumeSessionId: 'resume-id-123',
		} );

		expect( runStudioAgentTurn ).toHaveBeenCalledTimes( 1 );
		const callArgs = ( runStudioAgentTurn as Mock ).mock.calls[ 0 ][ 0 ] as { model: string };
		expect( callArgs.model ).toBe( 'claude-opus-5' );
	} );
} );

describe( 'AI runCommand — active site banner running state', () => {
	let stdoutSpy: ReturnType< typeof vi.spyOn >;

	const dispatchedPrompt = () =>
		( ( runStudioAgentTurn as Mock ).mock.calls[ 0 ][ 0 ] as { prompt: string } ).prompt;

	beforeEach( () => {
		vi.clearAllMocks();
		( createStudioSession as Mock ).mockResolvedValue( {
			appendCustomEntry: vi.fn( () => 'entry-id' ),
			getSessionId: () => 'session-id',
			getEntries: () => [],
		} );
		( readAuthToken as Mock ).mockResolvedValue( null );
		( readSelectedAiProvider as Mock ).mockResolvedValue( 'wpcom' );
		( resolveInitialAiProvider as Mock ).mockResolvedValue( 'wpcom' );
		stdoutSpy = vi.spyOn( process.stdout, 'write' ).mockImplementation( () => true );
	} );

	afterEach( () => {
		stdoutSpy.mockRestore();
	} );

	it( 'reports the site as running when the daemon says it is', async () => {
		( findSiteByFolder as Mock ).mockResolvedValue( {
			id: 'site-1',
			name: 'My Site',
			path: '/sites/my-site',
		} );
		( isSiteRunning as Mock ).mockResolvedValue( true );

		await runCommand( {
			adapter: new JsonAdapter(),
			initialMessage: 'hello',
			activeSite: { name: 'My Site', path: '/sites/my-site' },
		} );

		expect( dispatchedPrompt() ).toContain(
			'[Active site: "My Site" at /sites/my-site (running)]'
		);
	} );

	// STU-2040 regression guard: the per-turn isSiteRunning check opens a
	// DaemonBus socket; without a disconnect the headless (--json) process
	// never exits after the turn, and the desktop UI hangs in "working".
	it( 'closes the daemon socket after the per-turn running check so headless runs can exit', async () => {
		( findSiteByFolder as Mock ).mockResolvedValue( {
			id: 'site-1',
			name: 'My Site',
			path: '/sites/my-site',
		} );
		( isSiteRunning as Mock ).mockResolvedValue( true );

		await runCommand( {
			adapter: new JsonAdapter(),
			initialMessage: 'hello',
			activeSite: { name: 'My Site', path: '/sites/my-site' },
		} );

		expect( disconnectFromDaemon ).toHaveBeenCalled();
		const checkOrder = ( isSiteRunning as Mock ).mock.invocationCallOrder[ 0 ];
		const disconnectOrder = ( disconnectFromDaemon as Mock ).mock.invocationCallOrder[ 0 ];
		expect( disconnectOrder ).toBeGreaterThan( checkOrder );
	} );

	it( 'reports the site as stopped when the daemon says it is not running', async () => {
		( findSiteByFolder as Mock ).mockResolvedValue( {
			id: 'site-1',
			name: 'My Site',
			path: '/sites/my-site',
		} );
		( isSiteRunning as Mock ).mockResolvedValue( false );

		await runCommand( {
			adapter: new JsonAdapter(),
			initialMessage: 'hello',
			activeSite: { name: 'My Site', path: '/sites/my-site' },
		} );

		expect( dispatchedPrompt() ).toContain( '(stopped)' );
	} );

	it( 'treats a site missing from the CLI config as stopped', async () => {
		( findSiteByFolder as Mock ).mockResolvedValue( undefined );

		await runCommand( {
			adapter: new JsonAdapter(),
			initialMessage: 'hello',
			activeSite: { name: 'Gone', path: '/sites/gone' },
		} );

		expect( isSiteRunning ).not.toHaveBeenCalled();
		expect( dispatchedPrompt() ).toContain( '(stopped)' );
	} );

	it( 'skips the daemon check for remote sites', async () => {
		await runCommand( {
			adapter: new JsonAdapter(),
			initialMessage: 'hello',
			activeSite: {
				name: 'Live',
				path: '',
				remote: true,
				url: 'https://example.wordpress.com',
				wpcomSiteId: 123,
			},
		} );

		expect( findSiteByFolder ).not.toHaveBeenCalled();
		expect( isSiteRunning ).not.toHaveBeenCalled();
		expect( dispatchedPrompt() ).toContain(
			'[Active site: "Live" (ID: 123) at https://example.wordpress.com (WordPress.com)]'
		);
	} );
} );

describe( 'AI runCommand — Tracks events', () => {
	beforeEach( () => {
		vi.clearAllMocks();
		( createStudioSession as Mock ).mockResolvedValue( {
			appendCustomEntry: vi.fn( () => 'entry-id' ),
			getSessionId: () => 'session-id',
			getEntries: () => [],
			getSessionFile: () => '/sessions/session-id.jsonl',
		} );
		( readSelectedAiProvider as Mock ).mockResolvedValue( 'wpcom' );
		( resolveInitialAiProvider as Mock ).mockResolvedValue( 'wpcom' );
		( recordTracksEvent as Mock ).mockResolvedValue( undefined );
	} );

	const eventNames = () =>
		( recordTracksEvent as Mock ).mock.calls.map( ( [ name ] ) => name as string );

	// JSON mode exits right after the turn, so both events must be awaited rather than
	// fire-and-forget — the wrapper does async work (opt-out check, install id) before the request is
	// even issued. The mock defers past a microtask so a `void` call would still be in flight when
	// the command returns, the way it would be lost to process exit in a real headless run.
	it( 'records both chat events before a headless run returns', async () => {
		const settled: string[] = [];
		( recordTracksEvent as Mock ).mockImplementation( async ( name: string ) => {
			await new Promise( ( resolve ) => setTimeout( resolve, 0 ) );
			settled.push( name );
		} );

		await runCommand( { adapter: new JsonAdapter(), initialMessage: 'hello' } );

		expect( eventNames() ).toEqual( [
			TRACKS_EVENTS.CODE_MESSAGE_SENT,
			TRACKS_EVENTS.CODE_TURN_COMPLETED,
		] );
		expect( settled ).toEqual( [
			TRACKS_EVENTS.CODE_MESSAGE_SENT,
			TRACKS_EVENTS.CODE_TURN_COMPLETED,
		] );
	} );

	it( 'reports the turn outcome and the resolved provider and model', async () => {
		await runCommand( { adapter: new JsonAdapter(), initialMessage: 'hello' } );

		const [ , props ] = ( recordTracksEvent as Mock ).mock.calls.find(
			( [ name ] ) => name === TRACKS_EVENTS.CODE_TURN_COMPLETED
		) as [ string, Record< string, unknown > ];
		// `interrupted` because the mocked runtime resolves without an `agent_end` event, which is what
		// promotes the status — the point here is that the recorded outcome tracks `turnState`.
		expect( props ).toMatchObject( {
			outcome: 'interrupted',
			provider: 'wpcom',
			model_family: 'anthropic',
			ai_session_id: 'session-id',
			client: 'studio-code',
		} );
		expect( props.duration_ms ).toBeTypeOf( 'number' );
	} );

	// One call sits on the turn's critical path, the other in a `finally` where a rejection would
	// mask the turn's own error. Analytics must never break the chat.
	it( 'completes the turn even when recording fails', async () => {
		( recordTracksEvent as Mock ).mockRejectedValue( new Error( 'shared.json is locked' ) );

		await expect(
			runCommand( { adapter: new JsonAdapter(), initialMessage: 'hello' } )
		).resolves.toBeUndefined();
		expect( runStudioAgentTurn ).toHaveBeenCalledTimes( 1 );
	} );
} );
