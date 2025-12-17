import { app, utilityProcess, UtilityProcess } from 'electron';
import path from 'path';
import { kill } from 'process';
import { PHPRunOptions } from '@php-wasm/universal';
import * as Sentry from '@sentry/electron/renderer';
import { getWordPressProviderType } from 'src/lib/wordpress-provider';
import { WPNowOptions } from 'vendor/wp-now/src/config';
import type { WordPressServerProcess } from '../types';

export type MessageName = 'start-server' | 'stop-server' | 'run-php';

const DEFAULT_RESPONSE_TIMEOUT = 120000;

export default class SiteServerProcess implements WordPressServerProcess {
	lastMessageId = 0;
	options: WPNowOptions;
	process?: UtilityProcess;
	php?: { documentRoot: string };
	url: string;
	exitCode: number | null = null;

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
				this.exitCode = code;
				if ( code !== 0 ) {
					reject( new Error( `Site server process exited with code ${ code } upon starting` ) );
				}
			};

			this.process = utilityProcess
				.fork( path.join( __dirname, 'siteServerProcess.js' ), [ JSON.stringify( this.options ) ], {
					serviceName: 'studio-site-server',
					env: {
						...process.env,
						STUDIO_IN_CHILD_PROCESS: 'true',
						STUDIO_APP_NAME: app.name,
						STUDIO_APP_DATA_PATH: app.getPath( 'appData' ),
						STUDIO_APP_LOGS_PATH: app.getPath( 'logs' ),
						WORDPRESS_PROVIDER_TYPE: getWordPressProviderType(),
					},
				} )
				.on( 'spawn', spawnListener )
				.on( 'exit', exitListener );
		} );
	}

	async stop() {
		const message = 'stop-server';
		const messageId = this.sendMessage( message );
		try {
			await this.waitForResponse( message, messageId, 5_000 );
		} finally {
			await this.#killProcess();
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

		const messageId = this.lastMessageId++;
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
		if ( ! process || this.exitCode !== null ) {
			throw Error( 'Server process is not running. Exit code: ' + this.exitCode );
		}

		return new Promise< void >( ( resolve, reject ) => {
			process.once( 'exit', ( code ) => {
				if ( code !== 0 ) {
					reject( new Error( `Site server process exited with code ${ code } upon stopping` ) );
				} else {
					resolve();
				}
			} );
			if ( ! process.kill() ) {
				if ( process.pid ) {
					kill( process.pid, 'SIGKILL' );
				} else {
					resolve();
				}
			}
		} ).catch( ( error ) => {
			Sentry.captureException( error );
		} );
	}
}
