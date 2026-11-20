import { spawn } from 'node:child_process';
import { tailscaleEnv } from '@studio/common/lib/tailscale';
import { __, sprintf } from '@wordpress/i18n';
import type { EventEmitter } from 'node:events';

// `tailscale serve` for remote mode's Tailscale HTTPS connection, run in the
// foreground. Tailscale removes a foreground entry when the serving process's
// connection to it closes, also when that process is killed. A child is not
// killed with its parent, so `tailscale serve` runs under a small Node
// watchdog that holds an IPC channel to this process: the channel closes when
// this process ends in any way, even `kill -9`, and the watchdog then ends
// `tailscale serve`. The HTTPS address never outlives remote mode.
//
// The `tailscale` on PATH can be a shell script that runs the real binary as
// its child (Tailscale's macOS installer puts one there). Outside Windows the
// watchdog starts it in its own process group and ends the whole group.
export interface TailscaleServe {
	// Settles when the child ends, with its last error line if it printed one.
	ended: Promise< string | undefined >;
	stop: () => void;
}

interface ServeChild extends EventEmitter {
	stderr: EventEmitter | null;
	exitCode: number | null;
	signalCode: NodeJS.Signals | null;
	kill: () => boolean;
	connected?: boolean;
	disconnect?: () => void;
}

type SpawnServe = ( file: string, args: string[] ) => ServeChild;

// Run with `node -e`: its arguments are the Tailscale CLI and its own.
export const SERVE_WATCHDOG = `
const { spawn } = require( 'node:child_process' );
const [ cli, ...args ] = process.argv.slice( 1 );
const group = process.platform !== 'win32';
const serve = spawn( cli, args, {
	stdio: [ 'ignore', 'ignore', 'inherit' ],
	windowsHide: true,
	detached: group,
} );
const stop = () => {
	if ( serve.exitCode !== null || serve.signalCode !== null ) {
		return;
	}
	if ( ! group ) {
		serve.kill();
		return;
	}
	try {
		process.kill( -serve.pid, 'SIGTERM' );
	} catch {}
};
process.on( 'disconnect', stop );
process.on( 'SIGTERM', stop );
process.on( 'SIGINT', stop );
serve.on( 'error', ( error ) => {
	process.stderr.write( error.message + '\\n' );
	process.exit( 1 );
} );
serve.on( 'exit', ( code ) => process.exit( code ?? 1 ) );
`;

export const spawnServe: SpawnServe = ( file, args ) =>
	spawn( process.execPath, [ '-e', SERVE_WATCHDOG, file, ...args ], {
		env: tailscaleEnv(),
		stdio: [ 'ignore', 'ignore', 'pipe', 'ipc' ],
		windowsHide: true,
	} );

export function startTailscaleServe(
	cli: string,
	port: number,
	spawnFile: SpawnServe = spawnServe
): TailscaleServe {
	const child = spawnFile( cli, [ 'serve', `--https=${ port }`, `http://127.0.0.1:${ port }` ] );
	let lastError: string | undefined;
	child.stderr?.on( 'data', ( chunk: Buffer | string ) => {
		const lines = String( chunk )
			.split( /\r?\n/ )
			.map( ( line ) => line.trim() )
			.filter( Boolean );
		lastError = lines.at( -1 ) ?? lastError;
	} );
	const ended = new Promise< string | undefined >( ( resolve ) => {
		child.once( 'error', ( error: Error ) => resolve( error.message ) );
		child.once( 'exit', () => resolve( lastError ) );
	} );
	let stopped = false;
	return {
		ended,
		// Through the IPC channel when there is one: the watchdog's `disconnect`
		// handler ends `tailscale serve`. On Windows `kill` would end the watchdog
		// at once, without its handlers, and leave `tailscale serve` running. Only
		// once: a second stop would find the channel closed and kill the watchdog.
		stop: () => {
			if ( stopped || child.exitCode !== null || child.signalCode !== null ) {
				return;
			}
			stopped = true;
			if ( child.connected && child.disconnect ) {
				child.disconnect();
			} else {
				child.kill();
			}
		},
	};
}

// Waits until remote mode answers at its HTTPS address, which proves the
// certificate and the forwarding. The first certificate for a machine can
// take a while to arrive.
export async function waitForTailscaleHttps( {
	url,
	instanceId,
	ended,
	fetchFn = fetch,
	sleep = ( ms ) => new Promise( ( resolve ) => setTimeout( resolve, ms ) ),
	now = Date.now,
	limitMs = 60_000,
}: {
	url: string;
	instanceId: string;
	ended: Promise< string | undefined >;
	fetchFn?: ( url: string, init: RequestInit ) => Promise< Response >;
	sleep?: ( ms: number ) => Promise< void >;
	now?: () => number;
	limitMs?: number;
} ): Promise< void > {
	const serve: { ended: boolean; message?: string } = { ended: false };
	void ended.then( ( message ) => {
		serve.ended = true;
		serve.message = message;
	} );
	const deadline = now() + limitMs;
	// Certificate and name problems never end `tailscale serve`: they show only
	// in the requests, so the last one's reason goes into the error.
	let lastFailure: string | undefined;
	for (;;) {
		if ( serve.ended ) {
			throw new Error( serve.message ?? __( 'tailscale serve stopped.' ) );
		}
		try {
			const response = await fetchFn( `${ url }/.well-known/studio/remote`, {
				signal: AbortSignal.timeout( 5000 ),
			} );
			const body = response.ok ? await response.json() : undefined;
			if ( body?.instanceId === instanceId ) {
				return;
			}
			lastFailure = response.ok
				? __( 'another computer answered' )
				: sprintf( 'HTTP %d', response.status );
		} catch ( error ) {
			const failure = error as Error & { cause?: Error };
			lastFailure = failure.cause?.message ?? failure.message;
		}
		if ( now() >= deadline ) {
			throw new Error(
				sprintf(
					/* translators: %1$s: an address, like https://my-mac.tail1234.ts.net:8084; %2$s: why the last try failed. */
					__( 'No answer at %1$s within 60 seconds (%2$s).' ),
					url,
					lastFailure ?? __( 'no reason given' )
				)
			);
		}
		await sleep( 1000 );
	}
}
