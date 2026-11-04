import EventEmitter from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { signInWithChatGpt } from '@studio/common/lib/chatgpt-sign-in';
import { CliCommandError } from '@studio/common/lib/cli-process';
import type { ExecuteCliCommand } from '@studio/common/lib/cli-process';
import type { ChildProcess } from 'node:child_process';

// `killChild` sends signals on POSIX and runs `taskkill` on Windows; pin POSIX.
const originalPlatform = process.platform;
function setPlatform( platform: NodeJS.Platform ) {
	Object.defineProperty( process, 'platform', { value: platform, configurable: true } );
}

// A `studio code chatgpt login` process that waits for the browser until it is
// told to finish (`finish`) or killed, as the real command does.
function fakeLoginProcess() {
	const emitter = new EventEmitter();
	const child = new EventEmitter() as ChildProcess & { killed: boolean };
	Object.assign( child, {
		pid: 4321,
		exitCode: null,
		signalCode: null,
		kill: ( signal = 'SIGTERM' ) => {
			Object.assign( child, { signalCode: signal } );
			child.emit( 'exit', null, signal );
			child.emit( 'close', null, signal );
			emitter.emit( 'failure', {
				error: new CliCommandError( {
					lastErrorMessage: undefined,
					cliCommandResult: undefined,
					exitCode: null,
					signal: signal as NodeJS.Signals,
				} ),
			} );
			return true;
		},
	} );
	return {
		emitter,
		child,
		finish: () => {
			emitter.emit( 'data', { data: { action: 'result', value: { signedIn: true } } } );
			emitter.emit( 'success' );
		},
		fail: ( lastErrorMessage: string ) =>
			emitter.emit( 'failure', {
				error: new CliCommandError( {
					lastErrorMessage,
					cliCommandResult: undefined,
					exitCode: 1,
					signal: null,
				} ),
			} ),
	};
}

function fakeCli() {
	const processes: ReturnType< typeof fakeLoginProcess >[] = [];
	const execute = vi.fn( () => {
		const login = fakeLoginProcess();
		processes.push( login );
		return [ login.emitter, login.child ];
	} ) as unknown as ExecuteCliCommand;
	return { execute, processes };
}

describe( 'signInWithChatGpt', () => {
	beforeEach( () => setPlatform( 'darwin' ) );
	afterEach( () => setPlatform( originalPlatform ) );

	it( 'signs in through the CLI command', async () => {
		const { execute, processes } = fakeCli();

		const signIn = signInWithChatGpt( execute );
		processes[ 0 ].finish();

		await expect( signIn ).resolves.toBeUndefined();
		expect( execute ).toHaveBeenCalledWith(
			[ 'code', 'chatgpt', 'login' ],
			expect.objectContaining( { output: 'capture' } )
		);
	} );

	it( "rejects with the command's own error message", async () => {
		const { execute, processes } = fakeCli();

		const signIn = signInWithChatGpt( execute );
		processes[ 0 ].fail( 'ChatGPT authorization failed: access_denied' );

		await expect( signIn ).rejects.toThrow( /^ChatGPT authorization failed: access_denied$/ );
	} );

	it( 'stops a sign-in still waiting on the browser when another starts', async () => {
		const { execute, processes } = fakeCli();

		const first = signInWithChatGpt( execute );
		const second = signInWithChatGpt( execute );
		processes[ 1 ].finish();

		await expect( first ).rejects.toThrow( 'ChatGPT sign-in was cancelled.' );
		await expect( second ).resolves.toBeUndefined();
		expect( processes[ 0 ].child.signalCode ).toBe( 'SIGTERM' );
	} );
} );
