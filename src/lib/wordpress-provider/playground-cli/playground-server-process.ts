import { utilityProcess } from 'electron';
import path from 'path';
import {
	PLAYGROUND_CLI_INACTIVITY_TIMEOUT,
	PLAYGROUND_CLI_MAX_TIMEOUT,
	PLAYGROUND_CLI_ACTIVITY_CHECK_INTERVAL,
} from 'src/constants';
import { sendIpcEventToRendererWithWindow } from 'src/ipc-utils';
import { getMainWindow } from 'src/main-window';
import { WordPressServerProcess, WordPressServerOptions } from '../types';
import { PlaygroundCliOptions } from './playground-cli-provider';

export class PlaygroundServerProcess implements WordPressServerProcess {
	private process: Electron.UtilityProcess | null = null;
	private siteId: string | null = null;
	private messageId = 0;
	private responseHandlers = new Map<
		number,
		{ resolve: ( value: unknown ) => void; reject: ( reason: Error ) => void }
	>();
	private exitPromise: Promise< void > | null = null;
	private exitResolve: ( () => void ) | null = null;
	private isSetupMode = false;
	private lastActivityTimestamp = 0;
	private consoleMessageCallback?: ( message: string ) => void;

	constructor(
		public url: string,
		private options: PlaygroundCliOptions,
		private serverOptions: WordPressServerOptions
	) {}

	setConsoleMessageCallback( callback: ( message: string ) => void ): void {
		this.consoleMessageCallback = callback;
	}

	async start( siteId?: string ): Promise< void > {
		if ( this.process ) {
			return;
		}

		// Create exit promise before starting the process
		this.exitPromise = new Promise( ( resolve ) => {
			this.exitResolve = resolve;
		} );

		this.process = utilityProcess.fork( path.join( __dirname, 'playgroundServerProcess.js' ) );

		if ( siteId ) {
			this.siteId = siteId;
		}

		this.process.on(
			'message',
			async ( message: {
				type?: string;
				id?: number;
				error?: string;
				result?: unknown;
				message?: string;
			} ) => {
				if ( message.type === 'ready' ) {
					return;
				}

				if ( message.type === 'console-message' && message.message ) {
					if ( this.siteId ) {
						try {
							const mainWindow = await getMainWindow();
							sendIpcEventToRendererWithWindow( mainWindow, 'on-site-create-progress', {
								siteId: this.siteId,
								message: message.message,
							} );
						} catch ( error ) {
							console.error( 'Failed to get main window for site creation progress:', error );
						}
					}
					if ( this.consoleMessageCallback ) {
						this.consoleMessageCallback( message.message );
					}
				}

				if ( message.type === 'activity' || message.id !== undefined ) {
					this.lastActivityTimestamp = Date.now();
				}

				if ( message.id !== undefined && this.responseHandlers.has( message.id ) ) {
					const handler = this.responseHandlers.get( message.id )!;
					this.responseHandlers.delete( message.id );

					if ( message.error ) {
						handler.reject( new Error( message.error ) );
					} else {
						handler.resolve( message.result );
					}
				}
			}
		);

		this.process.on( 'exit', () => {
			this.process = null;

			// In setup mode (run-blueprint), process exit is expected after completion
			if ( ! this.isSetupMode ) {
				this.responseHandlers.forEach( ( { reject } ) => {
					reject( new Error( 'Process exited unexpectedly' ) );
				} );
			} else {
				this.responseHandlers.forEach( ( { resolve } ) => {
					resolve( undefined );
				} );
			}
			this.responseHandlers.clear();

			if ( this.exitResolve ) {
				this.exitResolve();
				this.exitResolve = null;
			}
		} );

		// Wait for child process to be ready
		await new Promise< void >( ( resolve ) => {
			const readyHandler = ( message: { type?: string } ) => {
				if ( message.type === 'ready' ) {
					this.process!.off( 'message', readyHandler );
					resolve();
				}
			};
			this.process!.on( 'message', readyHandler );
		} );

		await this.sendMessage( 'start-server', {
			options: this.options,
			serverOptions: this.serverOptions,
		} );
	}

	async stop(): Promise< void > {
		if ( ! this.process ) {
			return;
		}

		try {
			await this.sendMessage( 'stop-server', {} );
		} catch ( error ) {
			// Process might have already exited
		}

		// Force kill if still running
		if ( this.process ) {
			this.process.kill();
		}

		// Wait for the process to exit
		if ( this.exitPromise ) {
			await this.exitPromise;
		}

		this.process = null;
		this.exitPromise = null;
		this.exitResolve = null;
	}

	async runPhp( data: { code: string; [ key: string ]: unknown } ): Promise< string > {
		if ( ! this.process ) {
			throw new Error( 'Server process is not running' );
		}

		const result = await this.sendMessage( 'run-php', data );
		return result as string;
	}

	private async sendMessage( type: string, data: unknown ): Promise< unknown > {
		if ( ! this.process ) {
			throw new Error( 'Process is not running' );
		}

		const id = this.messageId++;

		return new Promise( ( resolve, reject ) => {
			this.responseHandlers.set( id, { resolve, reject } );

			const messageToSend = { id, type, data };
			this.process!.postMessage( messageToSend );

			this.lastActivityTimestamp = Date.now();
			const startTime = Date.now();

			const activityCheckInterval = setInterval( () => {
				if ( ! this.responseHandlers.has( id ) ) {
					clearInterval( activityCheckInterval );
					return;
				}

				const now = Date.now();
				const timeSinceLastActivity = now - this.lastActivityTimestamp;
				const totalElapsedTime = now - startTime;

				if (
					timeSinceLastActivity > PLAYGROUND_CLI_INACTIVITY_TIMEOUT ||
					totalElapsedTime > PLAYGROUND_CLI_MAX_TIMEOUT
				) {
					clearInterval( activityCheckInterval );
					if ( this.responseHandlers.has( id ) ) {
						this.responseHandlers.delete( id );
						const timeoutReason =
							totalElapsedTime > PLAYGROUND_CLI_MAX_TIMEOUT
								? `Maximum timeout of ${ PLAYGROUND_CLI_MAX_TIMEOUT / 1000 }s exceeded`
								: `No activity for ${ PLAYGROUND_CLI_INACTIVITY_TIMEOUT / 1000 }s`;
						reject(
							new Error( `Timeout waiting for response to message ${ id }: ${ timeoutReason }` )
						);
					}
				}
			}, PLAYGROUND_CLI_ACTIVITY_CHECK_INTERVAL );
		} );
	}

	get php() {
		return {
			documentRoot: this.options.documentRoot,
			run: ( options: { code: string; scriptPath?: string } ) =>
				this.runPhp( { ...options, phpVersion: this.options.phpVersion } ),
			request: async ( options: {
				url: string;
				method: string;
				body: Record< string, string >;
			} ) => {
				const result = await this.sendMessage( 'http-request', options );
				return result as { text: string };
			},
		};
	}
}
