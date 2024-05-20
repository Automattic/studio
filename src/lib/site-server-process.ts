import * as Sentry from '@sentry/electron/renderer';
import { app, utilityProcess, UtilityProcess } from 'electron';
import { PHPRunOptions } from '@php-wasm/universal';
import { WPNowOptions } from '../../vendor/wp-now/src/config';

// This allows TypeScript to pick up the magic constants that's auto-generated by Forge's Webpack
// plugin that tells the Electron app where to look for the Webpack-bundled app code (depending on
// whether you're running in development or production).
declare const SITE_SERVER_PROCESS_MODULE_PATH: string;

export type MessageName = 'start-server' | 'stop-server' | 'run-php';

const DEFAULT_RESPONSE_TIMEOUT = 120000;

export default class SiteServerProcess {
	lastMessageId = 0;
	options: WPNowOptions;
	process?: UtilityProcess;
	php?: { documentRoot: string };
	url: string;

	constructor( options: WPNowOptions ) {
		this.options = options;
		this.url = options.absoluteUrl ?? '';
	}

	async start(): Promise< void > {
		return new Promise( ( resolve, reject ) => {
			const spawnListener = async () => {
				const messageId = this.sendMessage( 'start-server' );
				try {
					const { php } = await this.waitForResponse< Pick< SiteServerProcess, 'php' > >(
						'start-server',
						messageId
					);
					this.php = php;
					// Removing exit listener as we only need it upon starting
					this.process?.off( 'exit', exitListener );
					resolve();
				} catch ( error ) {
					reject( error );
				}
			};
			const exitListener = ( code: number ) => {
				if ( code !== 0 ) {
					reject( new Error( `Site server process exited with code ${ code } upon starting` ) );
				}
			};

			this.process = utilityProcess
				.fork( SITE_SERVER_PROCESS_MODULE_PATH, [ JSON.stringify( this.options ) ], {
					serviceName: 'studio-site-server',
					env: {
						...process.env,
						STUDIO_SITE_SERVER_PROCESS: 'true',
						STUDIO_APP_NAME: app.name,
						STUDIO_APP_DATA_PATH: app.getPath( 'appData' ),
						STUDIO_APP_LOGS_PATH: app.getPath( 'logs' ),
					},
				} )
				.on( 'spawn', spawnListener )
				.on( 'exit', exitListener );
		} );
	}

	async stop() {
		const message = 'stop-server';
		const messageId = this.sendMessage( message );
		await this.waitForResponse( message, messageId );
		try {
			await this.#killProcess();
		} catch ( error ) {
			console.error( 'Error stopping site server process', error );
			Sentry.captureException( error );
		}
	}

	async runPhp( data: PHPRunOptions ): Promise< string > {
		const message = 'run-php';
		const messageId = this.sendMessage( message, data );
		return await this.waitForResponse( message, messageId );
	}

	sendMessage< T >( message: MessageName, data?: T ) {
		const process = this.process;
		if ( ! process ) {
			throw Error( 'Server process is not running' );
		}

		const messageId = +this.lastMessageId;
		process.postMessage( { message, messageId, data } );
		return messageId;
	}

	async waitForResponse< T = undefined >(
		originalMessage: MessageName,
		originalMessageId: number,
		timeout = DEFAULT_RESPONSE_TIMEOUT
	): Promise< T > {
		const process = this.process;
		if ( ! process ) {
			throw Error( 'Server process is not running' );
		}

		return new Promise( ( resolve, reject ) => {
			const handler = ( {
				message,
				messageId,
				data,
				error,
			}: {
				message: MessageName;
				messageId: number;
				data: T;
				error?: Error;
			} ) => {
				if ( message !== originalMessage || messageId !== originalMessageId ) {
					return;
				}
				process.removeListener( 'message', handler );
				clearTimeout( timeoutId );
				if ( typeof error !== 'undefined' ) {
					reject( error );
					return;
				}
				resolve( data );
			};

			const timeoutId = setTimeout( () => {
				reject( new Error( `Request for message ${ originalMessage } timed out` ) );
				process.removeListener( 'message', handler );
			}, timeout );

			process.addListener( 'message', handler );
		} );
	}

	async #killProcess(): Promise< void > {
		const process = this.process;
		if ( ! process ) {
			throw Error( 'Server process is not running' );
		}

		return new Promise( ( resolve, reject ) => {
			process.once( 'exit', ( code ) => {
				if ( code !== 0 ) {
					reject( new Error( `Site server process exited with code ${ code } upon stopping` ) );
					return;
				}
				resolve();
			} );
			process.kill();
		} );
	}
}
