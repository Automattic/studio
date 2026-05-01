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

	it( 'shows usage when no subcommand is given', async () => {
		const ui = makeUi();
		const result = await cmd.handler!( '/remote-session', makeCtx( ui ) );
		expect( ui.showInfo ).toHaveBeenCalledWith( expect.stringContaining( 'Usage' ) );
		expect( result ).toBe( 'continue' );
	} );

	it( 'rejects unknown subcommands by showing usage', async () => {
		const ui = makeUi();
		await cmd.handler!( '/remote-session bogus', makeCtx( ui ) );
		expect( ui.showInfo ).toHaveBeenCalledWith( expect.stringContaining( 'Usage' ) );
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
