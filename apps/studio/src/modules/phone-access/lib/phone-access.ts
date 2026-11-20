import { __, sprintf } from '@wordpress/i18n';
import type {
	RemoteConnectionKind,
	RemoteConnectionRequest,
} from '@studio/common/lib/remote-connection';

// Remote mode as the desktop app runs it for the Studio phone app: the
// bundled CLI's `studio remote`, started while the switch in Settings is on.
export type PhoneAccessState =
	| { status: 'off' }
	| { status: 'starting' }
	// `portChanged`: the remembered port was taken, so phones paired before must
	// pair again. `movedFrom`: the address remote mode had the last time it ran,
	// when it now has another one for another reason (a new connection, a new
	// network address); phones paired at that address must pair again.
	// `fallbackReason`: why Automatic did not take a safer connection.
	// `connection` is missing for a record from an older CLI.
	| {
			status: 'on';
			url: string;
			connection?: RemoteConnectionKind;
			portChanged: boolean;
			movedFrom?: string;
			fallbackReason?: string;
	  }
	// A `studio remote` the app did not start. It stops in its terminal.
	| {
			status: 'terminal';
			url: string;
			connection?: RemoteConnectionKind;
			fallbackReason?: string;
	  }
	| { status: 'error'; message: string };

// The process that runs `studio remote`.
export interface RemoteChild {
	pid: number | undefined;
	// Called once, when the process ends, with the CLI's error message if it
	// failed and printed one.
	onExit: ( listener: ( errorMessage?: string ) => void ) => void;
	stop: () => void;
}

export interface PhoneAccessParts {
	// The running remote mode's record in Studio's config, whoever started it.
	readServer: () => Promise<
		| { url: string; pid: number; connection?: RemoteConnectionKind; fallbackReason?: string }
		| undefined
	>;
	isAlive: ( pid: number ) => boolean;
	isPortFree: ( port: number ) => Promise< boolean >;
	startRemote: ( port: number, connection: RemoteConnectionRequest ) => RemoteChild;
	loadSettings: () => Promise< {
		enabled: boolean;
		port: number | undefined;
		connection: RemoteConnectionRequest;
		// The address phones used the last time remote mode ran.
		url: string | undefined;
	} >;
	// Never rejects: the app reports a failed write itself.
	saveSettings: ( update: {
		enabled?: boolean;
		port?: number;
		connection?: RemoteConnectionRequest;
		url?: string;
	} ) => Promise< void >;
	sleep: ( ms: number ) => Promise< void >;
}

// `studio remote`'s own default, then the next ones.
const FIRST_PORT = 8082;
const LAST_PORT = 8181;
// Tailscale HTTPS answers only once `studio remote` has checked its own HTTPS
// address, for up to a minute; Automatic then tries the tailnet.
const START_LIMIT_MS = { local: 15_000, tailscale: 90_000 };
const POLL_MS = 250;

// The child the app started, and a promise that settles when it has ended.
interface Own {
	process: RemoteChild;
	ended: Promise< void >;
}

export function createPhoneAccess( parts: PhoneAccessParts ) {
	let own: Own | null = null;
	let url: string | null = null;
	let connection: RemoteConnectionKind | undefined;
	let portChanged = false;
	let movedFrom: string | undefined;
	let fallbackReason: string | undefined;
	let lastError: string | null = null;
	let starting: Promise< PhoneAccessState > | null = null;
	// The app's child while it is being stopped: its record is not a terminal's.
	let stoppingPid: number | undefined;
	// Set at quit: nothing starts after it.
	let quitting = false;

	async function terminalServer() {
		const server = await parts.readServer();
		return server &&
			server.pid !== own?.process.pid &&
			server.pid !== stoppingPid &&
			parts.isAlive( server.pid )
			? server
			: undefined;
	}

	async function getState(): Promise< PhoneAccessState > {
		if ( starting ) {
			return { status: 'starting' };
		}
		if ( own && url ) {
			return { status: 'on', url, connection, portChanged, movedFrom, fallbackReason };
		}
		const terminal = await terminalServer();
		if ( terminal ) {
			return {
				status: 'terminal',
				url: terminal.url,
				connection: terminal.connection,
				fallbackReason: terminal.fallbackReason,
			};
		}
		return lastError ? { status: 'error', message: lastError } : { status: 'off' };
	}

	async function choosePort(
		remembered: number | undefined
	): Promise< { port: number; changed: boolean } | undefined > {
		if ( remembered !== undefined && ( await parts.isPortFree( remembered ) ) ) {
			return { port: remembered, changed: false };
		}
		for ( let port = FIRST_PORT; port <= LAST_PORT; port += 1 ) {
			if ( port !== remembered && ( await parts.isPortFree( port ) ) ) {
				return { port, changed: remembered !== undefined };
			}
		}
		return undefined;
	}

	// Remote mode went away without being turned off: the switch goes off with
	// the reason, and nothing starts it again by itself.
	function fail( message: string ): PhoneAccessState {
		lastError = message;
		// A save that fails is reported by the app; the switch shows off either way.
		void parts.saveSettings( { enabled: false } ).catch( () => undefined );
		return { status: 'error', message };
	}

	// Stops the app's child and settles once it has ended: its record is gone
	// and its port is free.
	async function stopOwn(): Promise< void > {
		const current = own;
		own = null;
		url = null;
		if ( current ) {
			stoppingPid = current.process.pid;
			current.process.stop();
			await current.ended;
			if ( stoppingPid === current.process.pid ) {
				stoppingPid = undefined;
			}
		}
	}

	async function start(): Promise< PhoneAccessState > {
		lastError = null;
		const terminal = await terminalServer();
		if ( terminal ) {
			return {
				status: 'terminal',
				url: terminal.url,
				connection: terminal.connection,
				fallbackReason: terminal.fallbackReason,
			};
		}
		const settings = await parts.loadSettings();
		const limitMs =
			settings.connection === 'local' ? START_LIMIT_MS.local : START_LIMIT_MS.tailscale;
		const chosen = await choosePort( settings.port );
		if ( ! chosen ) {
			return fail(
				sprintf(
					/* translators: %1$d and %2$d: the first and the last port Studio tries, like 8082 and 8181. */
					__( 'No free port between %1$d and %2$d.' ),
					FIRST_PORT,
					LAST_PORT
				)
			);
		}
		// The app quit while the port was chosen.
		if ( quitting ) {
			return { status: 'off' };
		}
		const started = parts.startRemote( chosen.port, settings.connection );
		const exit: { ended: boolean; message?: string } = { ended: false };
		let running = false;
		const ended = new Promise< void >( ( resolve ) => {
			started.onExit( ( message ) => {
				exit.ended = true;
				exit.message = message;
				resolve();
				// Turned off, quit, or still starting (the loop below reports it).
				if ( own?.process !== started || ! running ) {
					return;
				}
				own = null;
				url = null;
				fail( message ?? __( 'Remote mode stopped.' ) );
			} );
		} );
		own = { process: started, ended };
		for ( let waited = 0; ; waited += POLL_MS ) {
			// Turned off or quit while starting: nothing to report, and the switch
			// stays as it was saved.
			if ( own?.process !== started ) {
				return { status: 'off' };
			}
			if ( exit.ended ) {
				own = null;
				return fail( exit.message ?? __( 'Remote mode could not start.' ) );
			}
			if ( waited >= limitMs ) {
				await stopOwn();
				return fail(
					sprintf(
						/* translators: %d: a number of seconds, like 15. */
						__( 'Remote mode did not start within %d seconds.' ),
						limitMs / 1000
					)
				);
			}
			const server = await parts.readServer();
			if ( server && server.pid === started.pid && own?.process === started && ! exit.ended ) {
				// The switch is remembered as on only once remote mode runs.
				// A switch not saved as on only means it does not come back at the next launch.
				await parts
					.saveSettings( { enabled: true, port: chosen.port, url: server.url } )
					.catch( () => undefined );
				// Stopped or ended while saving: the checks above report it, after
				// this write, so the switch ends as they leave it.
				if ( own?.process === started && ! exit.ended ) {
					running = true;
					url = server.url;
					connection = server.connection;
					fallbackReason = server.fallbackReason;
					portChanged = chosen.changed;
					// Another address than last time, and not because the port moved
					// (that has its own message).
					movedFrom =
						settings.url !== undefined && settings.url !== url && ! chosen.changed
							? settings.url
							: undefined;
					return { status: 'on', url, connection, portChanged, movedFrom, fallbackReason };
				}
				continue;
			}
			await parts.sleep( POLL_MS );
		}
	}

	function startOnce(): Promise< PhoneAccessState > {
		if ( own && url ) {
			return getState();
		}
		starting ??= start().finally( () => {
			starting = null;
		} );
		return starting;
	}

	return {
		getState,

		turnOn(): Promise< PhoneAccessState > {
			return startOnce();
		},

		// A terminal's remote mode stays: it is stopped in its terminal.
		async turnOff(): Promise< PhoneAccessState > {
			if ( starting ) {
				await starting;
			}
			lastError = null;
			if ( own ) {
				await stopOwn();
			} else if ( await terminalServer() ) {
				return getState();
			}
			await parts.saveSettings( { enabled: false } );
			return { status: 'off' };
		},

		async getConnection(): Promise< RemoteConnectionRequest > {
			return ( await parts.loadSettings() ).connection;
		},

		// Saves the connection. A running remote mode starts again on it.
		async setConnection( request: RemoteConnectionRequest ): Promise< PhoneAccessState > {
			if ( starting ) {
				await starting;
			}
			await parts.saveSettings( { connection: request } );
			if ( ! own ) {
				return getState();
			}
			// Stopping and starting again is one start: turning off waits for it, and
			// the state reads "starting" until it is done.
			starting = ( async () => {
				await stopOwn();
				return start();
			} )().finally( () => {
				starting = null;
			} );
			return starting;
		},

		// At launch: remote mode comes back if the switch was on.
		async startIfEnabled(): Promise< void > {
			const { enabled } = await parts.loadSettings();
			if ( enabled ) {
				await startOnce();
			}
		},

		// At quit: stops remote mode and keeps the switch for the next launch.
		stop(): void {
			quitting = true;
			void stopOwn();
		},
	};
}
