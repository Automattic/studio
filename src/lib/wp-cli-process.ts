import { app, utilityProcess, UtilityProcess } from 'electron';
import path from 'path';
import * as Sentry from '@sentry/electron/renderer';
import {
	WP_CLI_DEFAULT_RESPONSE_TIMEOUT as DEFAULT_RESPONSE_TIMEOUT,
	WP_CLI_IMPORT_EXPORT_RESPONSE_TIMEOUT as IMPORT_EXPORT_RESPONSE_TIMEOUT,
} from 'src/constants';
import { getSqliteCommandPath } from 'src/lib/sqlite-command-path';
import { getWordPressProviderType } from 'src/lib/wordpress-provider';
import { getResourcesPath } from 'src/storage/paths';

export type MessageName = 'execute';
export type WpCliResult = Promise< { stdout: string; stderr: string; exitCode: number } >;
export type MessageCanceled = { error: Error; canceled: boolean };

export default class WpCliProcess {
	lastMessageId = 0;
	process?: UtilityProcess;
	ongoingMessages: Record< number, { cancelHandler: () => void } > = {};
	projectPath: string;

	constructor( projectPath: string ) {
		this.projectPath = projectPath;
	}

	async init(): Promise< void > {
		return new Promise( ( resolve, reject ) => {
			const spawnListener = async () => {
				// Removing exit listener as we only need it upon starting
				this.process?.off( 'exit', exitListener );
				resolve();
			};
			const exitListener = ( code: number ) => {
				if ( code !== 0 ) {
					reject( new Error( `wp-cli process exited with code ${ code } upon starting` ) );
				}
			};

			this.process = utilityProcess
				.fork( path.join( __dirname, 'wpCliProcess.js' ), [], {
					serviceName: 'studio-wp-cli-process',
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

	async execute(
		args: string[],
		{ phpVersion }: { phpVersion?: string } = {}
	): Promise< WpCliResult > {
		const message = 'execute';
		const messageData = {
			projectPath: this.projectPath,
			args,
			phpVersion,
			resourcesPath: getResourcesPath(),
			sqliteCommandPath: getSqliteCommandPath(),
		};

		const messageId = this.sendMessage( message, messageData );
		const timeout =
			args[ 0 ] === 'sqlite' && [ 'import', 'export' ].includes( args[ 1 ] )
				? IMPORT_EXPORT_RESPONSE_TIMEOUT
				: DEFAULT_RESPONSE_TIMEOUT;
		return await this.waitForResponse( message, messageId, timeout );
	}

	async stop() {
		await this.#killProcess();
	}

	sendMessage< T >( message: MessageName, data?: T ) {
		const process = this.process;
		if ( ! process ) {
			throw Error( 'wp-cli process is not running' );
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
			throw Error( 'wp-cli process is not running' );
		}
		if ( this.ongoingMessages[ originalMessageId ] ) {
			throw Error(
				`The 'waitForResponse' function was already called for message ID ${ originalMessageId } from the message '${ originalMessage }'. 'waitForResponse' may only be called once per message ID.`
			);
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
				error?: string;
			} ) => {
				if ( message !== originalMessage || messageId !== originalMessageId ) {
					return;
				}
				process.removeListener( 'message', handler );
				clearTimeout( timeoutId );
				delete this.ongoingMessages[ originalMessageId ];
				if ( typeof error !== 'undefined' ) {
					console.error( error );
					reject( new Error( error ) );
					return;
				}
				resolve( data );
			};

			const timeoutHandler = async () => {
				await this.#killProcess();
				process.removeListener( 'message', handler );
				reject( new Error( `Request for message ${ originalMessage } timed out` ) );
			};
			const timeoutId = setTimeout( timeoutHandler, timeout );
			const cancelHandler = () => {
				clearTimeout( timeoutId );
				reject( {
					error: new Error( `Request for message ${ originalMessage } was canceled` ),
					canceled: true,
				} as MessageCanceled );
				process.removeListener( 'message', handler );
			};
			this.ongoingMessages[ originalMessageId ] = { cancelHandler };

			process.addListener( 'message', handler );
		} );
	}

	async #killProcess(): Promise< void > {
		const process = this.process;
		if ( ! process ) {
			throw Error( 'wp-cli process is not running' );
		}

		this.#cancelOngoingMessages();

		return new Promise< void >( ( resolve, reject ) => {
			process.once( 'exit', ( code ) => {
				if ( code !== 0 ) {
					reject( new Error( `wp-cli process exited with code ${ code } upon stopping` ) );
					return;
				}
				resolve();
			} );
			process.kill();
		} ).catch( ( error ) => {
			Sentry.captureException( error );
		} );
	}

	#cancelOngoingMessages() {
		Object.values( this.ongoingMessages ).forEach( ( { cancelHandler } ) => {
			cancelHandler();
		} );
	}
}
