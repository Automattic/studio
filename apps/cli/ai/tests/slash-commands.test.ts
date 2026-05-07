import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	AI_CHAT_SLASH_COMMANDS,
	getActiveSlashCommands,
	type SlashCommandContext,
} from 'cli/ai/slash-commands';

describe( 'getActiveSlashCommands feature gate', () => {
	const originalValue = process.env.STUDIO_ENABLE_REMOTE_SESSION;

	beforeEach( () => {
		delete process.env.STUDIO_ENABLE_REMOTE_SESSION;
	} );

	afterEach( () => {
		if ( originalValue === undefined ) {
			delete process.env.STUDIO_ENABLE_REMOTE_SESSION;
		} else {
			process.env.STUDIO_ENABLE_REMOTE_SESSION = originalValue;
		}
	} );

	const has = ( name: string, cmds: { name: string }[] ) => cmds.some( ( c ) => c.name === name );

	it( 'omits /remote-session by default (flag off)', () => {
		expect( has( 'remote-session', getActiveSlashCommands() ) ).toBe( false );
	} );

	it( 'includes /remote-session when STUDIO_ENABLE_REMOTE_SESSION=true', () => {
		process.env.STUDIO_ENABLE_REMOTE_SESSION = 'true';
		expect( has( 'remote-session', getActiveSlashCommands() ) ).toBe( true );
	} );

	it.each( [ '1', 'TRUE', 'yes', 'on', '' ] )(
		'omits /remote-session for non-canonical truthy-looking values: %s',
		( value ) => {
			process.env.STUDIO_ENABLE_REMOTE_SESSION = value;
			expect( has( 'remote-session', getActiveSlashCommands() ) ).toBe( false );
		}
	);

	it( 'preserves non-gated commands when the flag is off', () => {
		const names = getActiveSlashCommands().map( ( c ) => c.name );
		expect( names ).toContain( 'clear' );
		expect( names ).toContain( 'login' );
		expect( names ).toContain( 'exit' );
	} );
} );

describe( '/remote-session slash command registration', () => {
	const cmd = AI_CHAT_SLASH_COMMANDS.find( ( c ) => c.name === 'remote-session' );

	it( 'is registered with a handler, feature gate, and argument completions', () => {
		expect( cmd ).toBeDefined();
		expect( typeof cmd!.handler ).toBe( 'function' );
		expect( typeof cmd!.enabled ).toBe( 'function' );
		expect( typeof cmd!.getArgumentCompletions ).toBe( 'function' );
		expect( cmd!.description ).toBeTruthy();
	} );

	it( 'returns start/stop as autocomplete suggestions', () => {
		const items = cmd!.getArgumentCompletions!( '' );
		const values = items?.map( ( i ) => i.value ).sort();
		expect( values ).toEqual( [ 'start', 'stop' ] );
	} );

	it( 'filters autocomplete suggestions by prefix (case-insensitive)', () => {
		expect(
			cmd!.getArgumentCompletions!( 'st' )
				?.map( ( i ) => i.value )
				.sort()
		).toEqual( [ 'start', 'stop' ] );
		expect( cmd!.getArgumentCompletions!( 'sta' )?.map( ( i ) => i.value ) ).toEqual( [ 'start' ] );
		expect( cmd!.getArgumentCompletions!( 'STO' )?.map( ( i ) => i.value ) ).toEqual( [ 'stop' ] );
	} );
} );

vi.mock( 'cli/ai/auth', () => ( {
	getAvailableAiProviders: vi.fn(),
	isAiProviderReady: vi.fn(),
} ) );

vi.mock( 'cli/commands/auth/login', () => ( { runCommand: vi.fn() } ) );
vi.mock( 'cli/commands/auth/logout', () => ( { runCommand: vi.fn() } ) );
vi.mock( 'cli/commands/preview/create', () => ( { runCommand: vi.fn() } ) );
vi.mock( 'cli/commands/preview/update', () => ( { runCommand: vi.fn() } ) );
vi.mock( 'cli/lib/browser', () => ( { openBrowser: vi.fn() } ) );
vi.mock( 'cli/ai/feedback-extraction', () => ( { extractFeedbackFields: vi.fn() } ) );
vi.mock( '@studio/common/lib/shared-config', () => ( { readAuthToken: vi.fn() } ) );

vi.mock( 'cli/remote-session/daemon', () => {
	return {
		startDaemon: vi.fn(),
		stopDaemon: vi.fn(),
		DaemonAlreadyRunningError: class DaemonAlreadyRunningError extends Error {
			pid: number;
			constructor( pid: number ) {
				super( `already running ${ pid }` );
				this.name = 'DaemonAlreadyRunningError';
				this.pid = pid;
			}
		},
		DaemonStartTimeoutError: class DaemonStartTimeoutError extends Error {
			constructor( message: string ) {
				super( message );
				this.name = 'DaemonStartTimeoutError';
			}
		},
	};
} );

vi.mock( 'cli/remote-session/config', () => {
	return {
		loadRemoteSessionConfig: vi.fn(),
	};
} );

vi.mock( 'cli/remote-session', () => {
	return {
		RemoteSessionConfigError: class RemoteSessionConfigError extends Error {
			missingFields: string[];
			constructor( message: string, missingFields: string[] = [] ) {
				super( message );
				this.name = 'RemoteSessionConfigError';
				this.missingFields = missingFields;
			}
		},
	};
} );

describe( '/remote-session slash command handler', () => {
	function makeUi() {
		return {
			showInfo: vi.fn(),
			showError: vi.fn(),
			showSuccess: vi.fn(),
			start: vi.fn(),
			stop: vi.fn(),
			setDaemonStatus: vi.fn(),
			askUser: vi.fn(),
		};
	}
	function makeCtx( ui: ReturnType< typeof makeUi > ): SlashCommandContext {
		return {
			ui: ui as unknown as SlashCommandContext[ 'ui' ],
			currentModel: 'claude-sonnet-4-5' as SlashCommandContext[ 'currentModel' ],
			currentProvider: 'wpcom' as SlashCommandContext[ 'currentProvider' ],
			showCapabilitiesOnConnect: false,
			switchProvider: vi.fn().mockResolvedValue( undefined ),
			prepareProviderSelection: vi.fn().mockResolvedValue( undefined ),
			maybeAutoSwitchProvider: vi.fn().mockResolvedValue( undefined ),
			persistSessionContext: vi.fn().mockResolvedValue( undefined ),
			clearSession: vi.fn().mockResolvedValue( undefined ),
		};
	}

	const cmd = AI_CHAT_SLASH_COMMANDS.find( ( c ) => c.name === 'remote-session' )!;

	beforeEach( async () => {
		const daemon = await import( 'cli/remote-session/daemon' );
		( daemon.startDaemon as ReturnType< typeof vi.fn > ).mockReset();
		( daemon.stopDaemon as ReturnType< typeof vi.fn > ).mockReset();
		const config = await import( 'cli/remote-session/config' );
		( config.loadRemoteSessionConfig as ReturnType< typeof vi.fn > ).mockReset();
		( config.loadRemoteSessionConfig as ReturnType< typeof vi.fn > ).mockResolvedValue( {} );
	} );

	it( 'pops an interactive picker when no subcommand is given', async () => {
		const daemon = await import( 'cli/remote-session/daemon' );
		( daemon.startDaemon as ReturnType< typeof vi.fn > ).mockResolvedValue( {
			pid: 4242,
			pidFile: '/tmp/x.pid',
		} );

		const ui = makeUi();
		ui.askUser.mockResolvedValue( { 0: 'Start' } );
		const result = await cmd.handler!( '/remote-session', makeCtx( ui ) );

		expect( ui.askUser ).toHaveBeenCalledOnce();
		const questions = ui.askUser.mock.calls[ 0 ][ 0 ];
		expect( questions[ 0 ].options.map( ( o: { label: string } ) => o.label ) ).toEqual( [
			'Start',
			'Stop',
		] );
		expect( daemon.startDaemon ).toHaveBeenCalledOnce();
		expect( ui.showSuccess ).toHaveBeenCalledWith( expect.stringContaining( '4242' ) );
		expect( result ).toBe( 'continue' );
	} );

	it( 'routes the picker selection to stop', async () => {
		const daemon = await import( 'cli/remote-session/daemon' );
		( daemon.stopDaemon as ReturnType< typeof vi.fn > ).mockResolvedValue( {
			stopped: true,
			pid: 555,
		} );

		const ui = makeUi();
		ui.askUser.mockResolvedValue( { 0: 'Stop' } );
		await cmd.handler!( '/remote-session', makeCtx( ui ) );

		expect( daemon.stopDaemon ).toHaveBeenCalledOnce();
		expect( ui.showSuccess ).toHaveBeenCalledWith( expect.stringContaining( '555' ) );
	} );

	it( 'is a no-op when the picker is canceled (Esc)', async () => {
		const daemon = await import( 'cli/remote-session/daemon' );
		const ui = makeUi();
		const abortError = Object.assign( new Error( 'aborted' ), { name: 'AbortPromptError' } );
		ui.askUser.mockRejectedValue( abortError );

		const result = await cmd.handler!( '/remote-session', makeCtx( ui ) );

		expect( daemon.startDaemon ).not.toHaveBeenCalled();
		expect( daemon.stopDaemon ).not.toHaveBeenCalled();
		expect( ui.showInfo ).toHaveBeenCalledWith( expect.stringContaining( 'canceled' ) );
		expect( result ).toBe( 'continue' );
	} );

	it( 'rejects unknown subcommands by showing usage', async () => {
		const ui = makeUi();
		await cmd.handler!( '/remote-session bogus', makeCtx( ui ) );
		expect( ui.showInfo ).toHaveBeenCalledWith( expect.stringContaining( 'Usage' ) );
		expect( ui.askUser ).not.toHaveBeenCalled();
	} );

	describe( 'start', () => {
		it( 'spawns the daemon, reports the PID, and sets the indicator', async () => {
			const daemon = await import( 'cli/remote-session/daemon' );
			( daemon.startDaemon as ReturnType< typeof vi.fn > ).mockResolvedValue( {
				pid: 12345,
				pidFile: '/tmp/x.pid',
			} );

			const ui = makeUi();
			await cmd.handler!( '/remote-session start', makeCtx( ui ) );

			expect( ui.showSuccess ).toHaveBeenCalledWith( expect.stringContaining( '12345' ) );
			expect( ui.setDaemonStatus ).toHaveBeenCalledWith( { running: true, pid: 12345 } );
			expect( daemon.startDaemon ).toHaveBeenCalledOnce();
		} );

		it( 'surfaces a missing-token config error without spawning anything', async () => {
			const config = await import( 'cli/remote-session/config' );
			const remote = await import( 'cli/remote-session' );
			( config.loadRemoteSessionConfig as ReturnType< typeof vi.fn > ).mockRejectedValue(
				new remote.RemoteSessionConfigError(
					'Remote session needs a bearer token to authenticate',
					[ 'token' ]
				)
			);

			const daemon = await import( 'cli/remote-session/daemon' );
			const ui = makeUi();
			await cmd.handler!( '/remote-session start', makeCtx( ui ) );

			expect( daemon.startDaemon ).not.toHaveBeenCalled();
			expect( ui.showError ).toHaveBeenCalledWith( expect.stringContaining( 'bearer token' ) );
			expect( ui.setDaemonStatus ).not.toHaveBeenCalled();
		} );

		it( 'reports a friendly message when the daemon is already running', async () => {
			const daemon = await import( 'cli/remote-session/daemon' );
			( daemon.startDaemon as ReturnType< typeof vi.fn > ).mockRejectedValue(
				new daemon.DaemonAlreadyRunningError( 999 )
			);

			const ui = makeUi();
			await cmd.handler!( '/remote-session start', makeCtx( ui ) );

			expect( ui.showInfo ).toHaveBeenCalledWith( expect.stringContaining( '999' ) );
			expect( ui.setDaemonStatus ).toHaveBeenCalledWith( { running: true, pid: 999 } );
		} );

		it( 'reports a friendly message on start timeout', async () => {
			const daemon = await import( 'cli/remote-session/daemon' );
			( daemon.startDaemon as ReturnType< typeof vi.fn > ).mockRejectedValue(
				new daemon.DaemonStartTimeoutError( 'timed out after 5000ms' )
			);

			const ui = makeUi();
			await cmd.handler!( '/remote-session start', makeCtx( ui ) );

			expect( ui.showError ).toHaveBeenCalledWith( expect.stringContaining( 'timed out' ) );
		} );

		it( 'surfaces unexpected loadRemoteSessionConfig errors via showError', async () => {
			const config = await import( 'cli/remote-session/config' );
			( config.loadRemoteSessionConfig as ReturnType< typeof vi.fn > ).mockRejectedValue(
				new Error( 'EACCES: permission denied' )
			);

			const daemon = await import( 'cli/remote-session/daemon' );
			const ui = makeUi();
			await expect( cmd.handler!( '/remote-session start', makeCtx( ui ) ) ).resolves.toBe(
				'continue'
			);

			expect( daemon.startDaemon ).not.toHaveBeenCalled();
			expect( ui.showError ).toHaveBeenCalledWith( expect.stringContaining( 'EACCES' ) );
		} );

		it( 'surfaces unexpected startDaemon errors via showError', async () => {
			const daemon = await import( 'cli/remote-session/daemon' );
			( daemon.startDaemon as ReturnType< typeof vi.fn > ).mockRejectedValue(
				new Error( 'spawn EAGAIN' )
			);

			const ui = makeUi();
			await expect( cmd.handler!( '/remote-session start', makeCtx( ui ) ) ).resolves.toBe(
				'continue'
			);

			expect( ui.showError ).toHaveBeenCalledWith( expect.stringContaining( 'EAGAIN' ) );
		} );
	} );

	describe( 'stop', () => {
		it( 'reports success and clears the indicator', async () => {
			const daemon = await import( 'cli/remote-session/daemon' );
			( daemon.stopDaemon as ReturnType< typeof vi.fn > ).mockResolvedValue( {
				stopped: true,
				pid: 4242,
			} );

			const ui = makeUi();
			await cmd.handler!( '/remote-session stop', makeCtx( ui ) );

			expect( ui.showSuccess ).toHaveBeenCalledWith( expect.stringContaining( '4242' ) );
			expect( ui.setDaemonStatus ).toHaveBeenCalledWith( { running: false } );
		} );

		it( 'is a no-op message when the daemon was already stopped', async () => {
			const daemon = await import( 'cli/remote-session/daemon' );
			( daemon.stopDaemon as ReturnType< typeof vi.fn > ).mockResolvedValue( {
				stopped: true,
				alreadyStopped: true,
			} );

			const ui = makeUi();
			await cmd.handler!( '/remote-session stop', makeCtx( ui ) );

			expect( ui.showInfo ).toHaveBeenCalledWith( expect.stringContaining( 'not running' ) );
			expect( ui.setDaemonStatus ).toHaveBeenCalledWith( { running: false } );
		} );

		it( 'surfaces a SIGKILL fallback notice', async () => {
			const daemon = await import( 'cli/remote-session/daemon' );
			( daemon.stopDaemon as ReturnType< typeof vi.fn > ).mockResolvedValue( {
				stopped: true,
				pid: 555,
				usedSigKill: true,
			} );

			const ui = makeUi();
			await cmd.handler!( '/remote-session stop', makeCtx( ui ) );

			expect( ui.showInfo ).toHaveBeenCalledWith( expect.stringContaining( 'SIGKILL' ) );
		} );

		it( 'surfaces an error when the daemon refuses to die', async () => {
			const daemon = await import( 'cli/remote-session/daemon' );
			( daemon.stopDaemon as ReturnType< typeof vi.fn > ).mockResolvedValue( {
				stopped: false,
				pid: 777,
				usedSigKill: true,
			} );

			const ui = makeUi();
			await cmd.handler!( '/remote-session stop', makeCtx( ui ) );

			expect( ui.showError ).toHaveBeenCalledWith( expect.stringContaining( '777' ) );
		} );

		it( 'surfaces unexpected stopDaemon errors via showError instead of throwing', async () => {
			const daemon = await import( 'cli/remote-session/daemon' );
			const err = Object.assign( new Error( 'kill EPERM' ), { code: 'EPERM' } );
			( daemon.stopDaemon as ReturnType< typeof vi.fn > ).mockRejectedValue( err );

			const ui = makeUi();
			await expect( cmd.handler!( '/remote-session stop', makeCtx( ui ) ) ).resolves.toBe(
				'continue'
			);

			expect( ui.showError ).toHaveBeenCalledWith( expect.stringContaining( 'EPERM' ) );
			// The on-disk state is unknown after a failed stop, so don't assert
			// on setDaemonStatus — the 5s poll catches up.
		} );
	} );
} );

const modelHandler = AI_CHAT_SLASH_COMMANDS.find( ( c ) => c.name === 'model' )?.handler;

function buildModelCtx(
	overrides: Partial< SlashCommandContext > & {
		askUserResponse: string;
	}
): { ctx: SlashCommandContext; persistMock: ReturnType< typeof vi.fn > } {
	const persistMock = vi.fn().mockResolvedValue( undefined );
	const ctx: SlashCommandContext = {
		// `as never` keeps this test framework-agnostic — we don't need a
		// real AiChatUI, just the methods the /model handler touches.
		ui: {
			currentModel: overrides.currentModel ?? 'gpt-5.5',
			askUser: vi.fn().mockResolvedValue( { 0: overrides.askUserResponse } ),
			showInfo: vi.fn(),
			showError: vi.fn(),
		} as never,
		currentModel: overrides.currentModel ?? 'gpt-5.5',
		currentProvider: 'wpcom',
		showCapabilitiesOnConnect: false,
		switchProvider: vi.fn().mockResolvedValue( undefined ),
		prepareProviderSelection: vi.fn().mockResolvedValue( undefined ),
		maybeAutoSwitchProvider: vi.fn().mockResolvedValue( undefined ),
		persistSessionContext: persistMock,
		clearSession: vi.fn().mockResolvedValue( undefined ),
	};
	return { ctx, persistMock };
}

describe( '/model slash command', () => {
	// Locks in the labelToId-map matcher introduced in slash-commands.ts.
	// The previous implementation used `selectedLabel.startsWith( label )`,
	// which silently picked the wrong id whenever one model's label was a
	// prefix of another's (e.g. "GPT 5.5" prefix of "GPT 5.5 Pro"). We don't
	// currently expose any prefix-colliding labels, but the fix is general
	// and we want the regression coverage to survive future additions.
	it( 'resolves the picked model exactly by label, not by prefix', async () => {
		expect( modelHandler ).toBeDefined();
		const { ctx, persistMock } = buildModelCtx( {
			currentModel: 'gpt-5.5',
			askUserResponse: 'Sonnet 4.6',
		} );

		await modelHandler!( '/model', ctx );

		expect( ctx.currentModel ).toBe( 'claude-sonnet-4-6' );
		expect( persistMock ).toHaveBeenCalledTimes( 1 );
	} );

	it( 'still resolves the picked model when its label carries the "(current)" suffix', async () => {
		const { ctx, persistMock } = buildModelCtx( {
			currentModel: 'gpt-5.5',
			askUserResponse: 'GPT 5.5 (current)',
		} );

		await modelHandler!( '/model', ctx );

		// Same model picked → no swap, no persist.
		expect( ctx.currentModel ).toBe( 'gpt-5.5' );
		expect( persistMock ).not.toHaveBeenCalled();
	} );
} );

describe( '/feedback slash command', () => {
	const cmd = AI_CHAT_SLASH_COMMANDS.find( ( c ) => c.name === 'feedback' )!;

	function makeUi() {
		return {
			showInfo: vi.fn(),
			showError: vi.fn(),
			showSuccess: vi.fn(),
			showProgress: vi.fn(),
			setBusy: vi.fn(),
			askUser: vi.fn(),
		};
	}
	function makeCtx( ui: ReturnType< typeof makeUi > ): SlashCommandContext {
		return {
			ui: ui as unknown as SlashCommandContext[ 'ui' ],
			currentModel: 'claude-sonnet-4-6' as SlashCommandContext[ 'currentModel' ],
			currentProvider: 'wpcom' as SlashCommandContext[ 'currentProvider' ],
			showCapabilitiesOnConnect: false,
			switchProvider: vi.fn().mockResolvedValue( undefined ),
			prepareProviderSelection: vi.fn().mockResolvedValue( undefined ),
			maybeAutoSwitchProvider: vi.fn().mockResolvedValue( undefined ),
			persistSessionContext: vi.fn().mockResolvedValue( undefined ),
			clearSession: vi.fn().mockResolvedValue( undefined ),
		};
	}

	beforeEach( async () => {
		const browser = await import( 'cli/lib/browser' );
		( browser.openBrowser as ReturnType< typeof vi.fn > ).mockReset();
		( browser.openBrowser as ReturnType< typeof vi.fn > ).mockResolvedValue( undefined );
		const extraction = await import( 'cli/ai/feedback-extraction' );
		( extraction.extractFeedbackFields as ReturnType< typeof vi.fn > ).mockReset();
		// Default: no AI signal — tests opt in to extraction by overriding.
		( extraction.extractFeedbackFields as ReturnType< typeof vi.fn > ).mockResolvedValue( null );
	} );

	it( 'is registered with a handler and description', () => {
		expect( cmd ).toBeDefined();
		expect( typeof cmd.handler ).toBe( 'function' );
		expect( cmd.description ).toBeTruthy();
	} );

	it( 'opens GitHub with the feedback pre-filled when the user confirms', async () => {
		const ui = makeUi();
		ui.askUser
			.mockResolvedValueOnce( { 'Describe the issue or feedback': 'something is broken' } )
			.mockResolvedValueOnce( { 'Open GitHub with this report?': 'Submit on GitHub' } );

		const result = await cmd.handler!( '/feedback', makeCtx( ui ) );

		const browser = await import( 'cli/lib/browser' );
		expect( browser.openBrowser ).toHaveBeenCalledOnce();
		const url = ( browser.openBrowser as ReturnType< typeof vi.fn > ).mock.calls[ 0 ][ 0 ];
		const params = new URL( url ).searchParams;
		expect( url ).toContain( 'github.com/Automattic/studio/issues/new' );
		expect( url ).toContain( 'template=bug_report.yml' );
		expect( params.get( 'title' ) ).toBe( 'something is broken' );
		expect( params.get( 'summary' ) ).toBe( 'something is broken' );
		expect( params.get( 'logs' ) ).toBeTruthy();
		// AI extraction returned null in this test — fields without honest
		// signal stay unset rather than getting force-filled.
		expect( params.has( 'steps' ) ).toBe( false );
		expect( params.has( 'expected' ) ).toBe( false );
		expect( params.has( 'actual' ) ).toBe( false );
		expect( params.has( 'users-affected' ) ).toBe( false );
		expect( params.has( 'workarounds' ) ).toBe( false );
		expect( ui.showSuccess ).toHaveBeenCalledOnce();
		expect( result ).toBe( 'continue' );
	} );

	it( 'pre-fills steps/expected/actual/impact/workarounds when AI extraction returns them', async () => {
		const extraction = await import( 'cli/ai/feedback-extraction' );
		( extraction.extractFeedbackFields as ReturnType< typeof vi.fn > ).mockResolvedValue( {
			title: 'Sites fail to start after update',
			steps: '1. Update Studio.\n2. Click Start on a site.',
			expected: 'The site should start and serve on its assigned port.',
			actual: 'The Start button spins forever and the port stays closed.',
			impact: 'All',
			workaround: 'No and the app is unusable',
		} );

		const ui = makeUi();
		ui.askUser
			.mockResolvedValueOnce( {
				'Describe the issue or feedback':
					'After updating, every site I try to start just spins. The app is basically dead.',
			} )
			.mockResolvedValueOnce( { 'Open GitHub with this report?': 'Submit on GitHub' } );

		await cmd.handler!( '/feedback', makeCtx( ui ) );

		const browser = await import( 'cli/lib/browser' );
		const url = ( browser.openBrowser as ReturnType< typeof vi.fn > ).mock.calls[ 0 ][ 0 ];
		const params = new URL( url ).searchParams;
		expect( params.get( 'title' ) ).toBe( 'Sites fail to start after update' );
		expect( params.get( 'steps' ) ).toContain( 'Update Studio' );
		expect( params.get( 'expected' ) ).toContain( 'serve on its assigned port' );
		expect( params.get( 'actual' ) ).toContain( 'spins forever' );
		expect( params.get( 'users-affected' ) ).toBe( 'All' );
		expect( params.get( 'workarounds' ) ).toBe( 'No and the app is unusable' );
		// Description still flows into summary verbatim.
		expect( params.get( 'summary' ) ).toContain( 'every site I try to start' );
	} );

	it( 'falls back to the first-line title when AI returns no title', async () => {
		const extraction = await import( 'cli/ai/feedback-extraction' );
		( extraction.extractFeedbackFields as ReturnType< typeof vi.fn > ).mockResolvedValue( {
			title: null,
			steps: null,
			expected: null,
			actual: null,
			impact: null,
			workaround: null,
		} );

		const ui = makeUi();
		ui.askUser
			.mockResolvedValueOnce( {
				'Describe the issue or feedback': 'something headline\nbody text follows',
			} )
			.mockResolvedValueOnce( { 'Open GitHub with this report?': 'Submit on GitHub' } );

		await cmd.handler!( '/feedback', makeCtx( ui ) );

		const browser = await import( 'cli/lib/browser' );
		const url = ( browser.openBrowser as ReturnType< typeof vi.fn > ).mock.calls[ 0 ][ 0 ];
		expect( new URL( url ).searchParams.get( 'title' ) ).toBe( 'something headline' );
	} );

	it( 'truncates a long first line into a title that fits the issue title field', async () => {
		const ui = makeUi();
		const longLine = 'x'.repeat( 200 );
		ui.askUser
			.mockResolvedValueOnce( { 'Describe the issue or feedback': longLine } )
			.mockResolvedValueOnce( { 'Open GitHub with this report?': 'Submit on GitHub' } );

		await cmd.handler!( '/feedback', makeCtx( ui ) );

		const browser = await import( 'cli/lib/browser' );
		const url = ( browser.openBrowser as ReturnType< typeof vi.fn > ).mock.calls[ 0 ][ 0 ];
		const title = new URL( url ).searchParams.get( 'title' ) ?? '';
		expect( title.length ).toBeLessThanOrEqual( 80 );
		expect( title.endsWith( '…' ) ).toBe( true );
		// The full description still goes into summary, untruncated.
		expect( new URL( url ).searchParams.get( 'summary' ) ).toBe( longLine );
	} );

	it( 'derives the title from only the first line of a multi-line description', async () => {
		const ui = makeUi();
		ui.askUser
			.mockResolvedValueOnce( {
				'Describe the issue or feedback': 'short headline\nlots of detail on the next line',
			} )
			.mockResolvedValueOnce( { 'Open GitHub with this report?': 'Submit on GitHub' } );

		await cmd.handler!( '/feedback', makeCtx( ui ) );

		const browser = await import( 'cli/lib/browser' );
		const url = ( browser.openBrowser as ReturnType< typeof vi.fn > ).mock.calls[ 0 ][ 0 ];
		expect( new URL( url ).searchParams.get( 'title' ) ).toBe( 'short headline' );
	} );

	it( 'pre-fills the platform dropdown when running on a known platform', async () => {
		const originalPlatform = process.platform;
		const originalArch = process.arch;
		Object.defineProperty( process, 'platform', { value: 'darwin', configurable: true } );
		Object.defineProperty( process, 'arch', { value: 'arm64', configurable: true } );
		try {
			const ui = makeUi();
			ui.askUser
				.mockResolvedValueOnce( { 'Describe the issue or feedback': 'mac silicon issue' } )
				.mockResolvedValueOnce( { 'Open GitHub with this report?': 'Submit on GitHub' } );

			await cmd.handler!( '/feedback', makeCtx( ui ) );

			const browser = await import( 'cli/lib/browser' );
			const url = ( browser.openBrowser as ReturnType< typeof vi.fn > ).mock.calls[ 0 ][ 0 ];
			expect( new URL( url ).searchParams.get( 'site-type' ) ).toBe( 'Mac Silicon' );
		} finally {
			Object.defineProperty( process, 'platform', { value: originalPlatform } );
			Object.defineProperty( process, 'arch', { value: originalArch } );
		}
	} );

	it( 'omits the platform dropdown on platforms without a matching template option', async () => {
		const originalPlatform = process.platform;
		Object.defineProperty( process, 'platform', { value: 'linux', configurable: true } );
		try {
			const ui = makeUi();
			ui.askUser
				.mockResolvedValueOnce( { 'Describe the issue or feedback': 'on linux' } )
				.mockResolvedValueOnce( { 'Open GitHub with this report?': 'Submit on GitHub' } );

			await cmd.handler!( '/feedback', makeCtx( ui ) );

			const browser = await import( 'cli/lib/browser' );
			const url = ( browser.openBrowser as ReturnType< typeof vi.fn > ).mock.calls[ 0 ][ 0 ];
			expect( new URL( url ).searchParams.has( 'site-type' ) ).toBe( false );
		} finally {
			Object.defineProperty( process, 'platform', { value: originalPlatform } );
		}
	} );

	it( 'does not open the browser when the user picks Cancel at confirmation', async () => {
		const ui = makeUi();
		ui.askUser
			.mockResolvedValueOnce( { 'Describe the issue or feedback': 'minor nit' } )
			.mockResolvedValueOnce( { 'Open GitHub with this report?': 'Cancel' } );

		await cmd.handler!( '/feedback', makeCtx( ui ) );

		const browser = await import( 'cli/lib/browser' );
		expect( browser.openBrowser ).not.toHaveBeenCalled();
		expect( ui.showInfo ).toHaveBeenCalledWith( expect.stringContaining( 'canceled' ) );
	} );

	it( 'cancels when the description is empty', async () => {
		const ui = makeUi();
		ui.askUser.mockResolvedValueOnce( { 'Describe the issue or feedback': '   ' } );

		await cmd.handler!( '/feedback', makeCtx( ui ) );

		const browser = await import( 'cli/lib/browser' );
		expect( browser.openBrowser ).not.toHaveBeenCalled();
		// Only the description was prompted — confirmation step was skipped.
		expect( ui.askUser ).toHaveBeenCalledOnce();
	} );

	it( 'cancels gracefully when the prompt is aborted (Esc)', async () => {
		const ui = makeUi();
		const abortError = Object.assign( new Error( 'aborted' ), { name: 'AbortPromptError' } );
		ui.askUser.mockRejectedValueOnce( abortError );

		const result = await cmd.handler!( '/feedback', makeCtx( ui ) );

		const browser = await import( 'cli/lib/browser' );
		expect( browser.openBrowser ).not.toHaveBeenCalled();
		expect( ui.showInfo ).toHaveBeenCalledWith( expect.stringContaining( 'canceled' ) );
		expect( result ).toBe( 'continue' );
	} );
} );
