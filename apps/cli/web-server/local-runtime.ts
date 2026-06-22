import { fork } from 'node:child_process';
import type { AgentProcess, AgentProcessOptions, AgentRuntime } from './runtime';
import type { JsonEvent } from '@studio/common/ai/json-events';

/**
 * Runs the agent as a local child process: it re-invokes this same CLI bundle
 * as `studio code sessions resume <id> <prompt> --json` — the exact subcommand
 * the desktop app forks — and reads the JSON transport over the Node IPC
 * channel. This is the local-development runtime; the hosted backend swaps in a
 * runtime that runs the agent inside a per-session SecEx sandbox instead.
 */
export const localRuntime: AgentRuntime = {
	start( {
		sessionId,
		prompt,
		displayMessage,
		onSpawn,
		onEvent,
		onError,
		onExit,
	}: AgentProcessOptions ): AgentProcess {
		const args = [ 'code', 'sessions', 'resume', sessionId, prompt, '--json', '--avoid-telemetry' ];
		if ( displayMessage ) {
			args.push( '--display-message', displayMessage );
		}

		const child = fork( process.argv[ 1 ], args, {
			stdio: [ 'ignore', 'inherit', 'inherit', 'ipc' ],
			execArgv: [ '--experimental-wasm-jspi' ],
			env: { ...process.env },
		} );

		child.on( 'spawn', onSpawn );
		child.on( 'message', ( message ) => {
			// The CLI's Logger also writes to this channel with a different shape;
			// forward only messages that look like the JSON transport envelope.
			if ( message && typeof message === 'object' && 'type' in message ) {
				onEvent( message as JsonEvent );
			}
		} );
		child.on( 'error', ( error ) => onError( error.message || 'CLI subprocess failed to start' ) );
		child.on( 'exit', onExit );

		return {
			get connected() {
				return child.connected;
			},
			interrupt() {
				if ( child.connected ) {
					child.send( { type: 'interrupt' } );
				}
			},
			kill() {
				child.kill( 'SIGKILL' );
			},
			answer( answers ) {
				if ( child.connected ) {
					child.send( { type: 'answer', answers } );
				}
			},
		};
	},
};
