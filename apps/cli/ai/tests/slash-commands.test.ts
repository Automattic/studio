import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	AI_CHAT_SLASH_COMMANDS,
	getActiveSlashCommands,
	type SlashCommandContext,
} from 'cli/ai/slash-commands';
import { areNotificationsEnabled, setNotificationsEnabled } from 'cli/lib/notify';

describe( '/remote-session slash command registration', () => {
	const cmd = AI_CHAT_SLASH_COMMANDS.find( ( c ) => c.name === 'remote-session' );

	it( 'is registered with a handler and argument completions', () => {
		expect( cmd ).toBeDefined();
		expect( typeof cmd!.handler ).toBe( 'function' );
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
vi.mock( '@studio/common/lib/shared-config', () => ( { readAuthToken: vi.fn() } ) );
vi.mock( 'cli/lib/notify', () => ( {
	areNotificationsEnabled: vi.fn(),
	setNotificationsEnabled: vi.fn().mockResolvedValue( undefined ),
} ) );

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
			askUserResponse: 'Sonnet 5',
		} );

		await modelHandler!( '/model', ctx );

		expect( ctx.currentModel ).toBe( 'claude-sonnet-5' );
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

describe( '/notifications slash command', () => {
	const cmd = AI_CHAT_SLASH_COMMANDS.find( ( c ) => c.name === 'notifications' )!;

	function makeUi() {
		return { showInfo: vi.fn() };
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

	afterEach( () => {
		vi.mocked( areNotificationsEnabled ).mockReset();
		vi.mocked( setNotificationsEnabled ).mockClear();
	} );

	it( 'is registered with a handler and a discoverable description', () => {
		expect( cmd ).toBeDefined();
		expect( typeof cmd.handler ).toBe( 'function' );
		expect( cmd.description ).toBeTruthy();
	} );

	// Regression test: the interactive autocomplete (DescriptionAwareAutocompleteProvider
	// in ai/ui.ts) is wired directly to getActiveSlashCommands() — there is no separate
	// list to keep in sync. If this ever stops finding the command, autocomplete broke too.
	it( 'shows up in the list the interactive autocomplete reads from', () => {
		const active = getActiveSlashCommands().find( ( c ) => c.name === 'notifications' );
		expect( active ).toBeDefined();
		expect( typeof active!.handler ).toBe( 'function' );
	} );

	it( 'enables notifications and reports the new state when currently disabled', async () => {
		vi.mocked( areNotificationsEnabled ).mockResolvedValue( false );
		const ui = makeUi();
		const result = await cmd.handler!( '/notifications', makeCtx( ui ) );

		expect( setNotificationsEnabled ).toHaveBeenCalledWith( true );
		expect( ui.showInfo ).toHaveBeenCalledWith( expect.stringContaining( 'enabled' ) );
		expect( result ).toBe( 'continue' );
	} );

	it( 'disables notifications and reports the new state when currently enabled', async () => {
		vi.mocked( areNotificationsEnabled ).mockResolvedValue( true );
		const ui = makeUi();
		await cmd.handler!( '/notifications', makeCtx( ui ) );

		expect( setNotificationsEnabled ).toHaveBeenCalledWith( false );
		expect( ui.showInfo ).toHaveBeenCalledWith( expect.stringContaining( 'disabled' ) );
	} );
} );
