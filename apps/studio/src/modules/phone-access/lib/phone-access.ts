import { __, sprintf } from '@wordpress/i18n';

// Remote mode as the desktop app runs it for the Studio phone app: the
// bundled CLI's `studio remote`, started while the switch in Settings is on.
export type PhoneAccessState =
	| { status: 'off' }
	| { status: 'starting' }
	// `portChanged`: the remembered port was taken, so phones paired before
	// must pair again.
	| { status: 'on'; url: string; portChanged: boolean }
	// A `studio remote` the app did not start. It stops in its terminal.
	| { status: 'terminal'; url: string }
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
	readServer: () => Promise< { url: string; pid: number } | undefined >;
	isAlive: ( pid: number ) => boolean;
	isPortFree: ( port: number ) => Promise< boolean >;
	startRemote: ( port: number ) => RemoteChild;
	loadSettings: () => Promise< { enabled: boolean; port: number | undefined } >;
	// Never rejects: the app reports a failed write itself.
	saveSettings: ( update: { enabled?: boolean; port?: number } ) => Promise< void >;
	sleep: ( ms: number ) => Promise< void >;
}

// `studio remote`'s own default, then the next ones.
const FIRST_PORT = 8082;
const LAST_PORT = 8181;
const START_LIMIT_MS = 15_000;
const POLL_MS = 250;

// The child the app started, and a promise that settles when it has ended.
interface Own {
	process: RemoteChild;
	ended: Promise< void >;
}

export function createPhoneAccess( parts: PhoneAccessParts ) {
	let own: Own | null = null;
	let url: string | null = null;
	let portChanged = false;
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
			return { status: 'on', url, portChanged };
		}
		const terminal = await terminalServer();
		if ( terminal ) {
			return { status: 'terminal', url: terminal.url };
		}
		return lastError ? { status: 'error', message: lastError } : { status: 'off' };
	}

	async function choosePort(): Promise< { port: number; changed: boolean } | undefined > {
		const { port: remembered } = await parts.loadSettings();
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
		void parts.saveSettings( { enabled: false } );
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
			return { status: 'terminal', url: terminal.url };
		}
		const chosen = await choosePort();
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
		const started = parts.startRemote( chosen.port );
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
			if ( waited >= START_LIMIT_MS ) {
				await stopOwn();
				return fail( __( 'Remote mode did not start within 15 seconds.' ) );
			}
			const server = await parts.readServer();
			if ( server && server.pid === started.pid && own?.process === started && ! exit.ended ) {
				// The switch is remembered as on only once remote mode runs.
				await parts.saveSettings( { enabled: true, port: chosen.port } );
				// Stopped or ended while saving: the checks above report it, after
				// this write, so the switch ends as they leave it.
				if ( own?.process === started && ! exit.ended ) {
					running = true;
					url = server.url;
					portChanged = chosen.changed;
					return { status: 'on', url, portChanged };
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
