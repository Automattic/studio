import { ChildProcess } from 'node:child_process';
import { format } from 'node:util';
import { NativePhpRuntime } from 'cli/lib/process-manager/native-php-runtime';
import { ChildMessageRaw, ManagerMessage } from 'cli/lib/types/wordpress-server-ipc';
import { ManagedProcessCallbacks } from './managed-process';
import { ManagedProcessBase } from './managed-process-base';

const STOP_SERVER_TIMEOUT = 5000;
const FORCE_STOP_TIMEOUT = 2500;

enum NativePhpStopServerResult {
	ABORTED_STARTUP = 'ABORTED_STARTUP',
	OK = 'OK',
}

type NativePhpWordPressServerProcessOptions = {
	pmId: number;
	name: string;
	callbacks: ManagedProcessCallbacks;
};

type ServerExitHandler = ( code: number | null, signal: NodeJS.Signals | null ) => void;

function hasChildExited( child: ChildProcess ): boolean {
	return child.exitCode !== null || child.signalCode !== null;
}

function isChildRunning( child: ChildProcess ): boolean {
	return ! hasChildExited( child );
}

function splitLogMessage( message: string ): string[] {
	return message.split( /\r?\n/ );
}

export class ManagedProcessWordPressNativePhp extends ManagedProcessBase {
	private readonly runtime: NativePhpRuntime;
	private readonly abortControllers: Record< string, AbortController > = {};
	private readonly activePhpProcesses = new Set< ChildProcess >();
	private serverProcess: ChildProcess | null = null;
	private serverExitHandler: ServerExitHandler | null = null;
	private startupAbortController: AbortController | null = null;
	private startingPromise: Promise< void > | null = null;

	constructor( { pmId, name, callbacks }: NativePhpWordPressServerProcessOptions ) {
		super( pmId, name, callbacks );

		this.runtime = new NativePhpRuntime( {
			onActivity: () => {
				void this.emitMessage( { topic: 'activity' } );
			},
			onStdoutLine: ( line ) => {
				this.writeStdoutLine( line );
			},
			onStderrLine: ( line ) => {
				this.writeStderrLine( line );
			},
			onPhpProcessSpawn: ( child ) => {
				this.trackPhpProcess( child );
			},
		} );
	}

	async start(): Promise< void > {
		this.currentPid = process.pid;
		this.currentStatus = 'online';
		await this.emitEvent( { event: 'online' } );
		await this.emitMessage( { topic: 'ready' } );
	}

	async stop(): Promise< void > {
		if ( this.status !== 'online' ) {
			return;
		}

		await this.forceStop();
		await this.emitEvent( { event: 'delete' } );
		await this.settleAndEmitExit();
	}

	async forceStop(): Promise< void > {
		this.detachServerExitHandler();
		this.startupAbortController?.abort();
		for ( const abortController of Object.values( this.abortControllers ) ) {
			abortController.abort();
		}

		const children = Array.from( this.activePhpProcesses );
		for ( const child of children ) {
			this.terminatePhpProcess( child, 'SIGKILL' );
		}
		this.serverProcess = null;

		await Promise.race( [
			Promise.allSettled( children.map( ( child ) => this.waitForChildExit( child ) ) ),
			new Promise< void >( ( resolve ) => setTimeout( resolve, FORCE_STOP_TIMEOUT ) ),
		] );
	}

	async sendMessage( message: ManagerMessage ): Promise< void > {
		void this.handleMessage( message );
	}

	private async handleMessage( message: ManagerMessage ): Promise< void > {
		if ( message.topic !== 'abort' ) {
			this.abortControllers[ message.messageId ] = new AbortController();
		}
		const abortController = this.abortControllers[ message.messageId ];
		const getAbortSignal = () => {
			if ( ! abortController ) {
				throw new Error( `Missing abort controller for message ${ message.messageId }` );
			}
			return abortController.signal;
		};

		this.logToConsole( `Received ${ message.topic } message` );

		try {
			let result: unknown;

			switch ( message.topic ) {
				case 'abort':
					abortController?.abort();
					return;
				case 'start-server':
					await this.startServer( message.data.config, getAbortSignal() );
					break;
				case 'stop-server':
					result = await this.stopServer();
					break;
				case 'run-blueprint':
					result = await this.runtime.runBlueprint( message.data.config, getAbortSignal() );
					break;
				case 'wp-cli-command':
					throw new Error(
						`Message "${ message.topic }" is not supported by the native PHP runtime`
					);
			}

			if ( this.settled ) {
				return;
			}

			await this.emitMessage( this.createResultMessage( message.messageId, result ) );

			if (
				message.topic === 'stop-server' &&
				result === NativePhpStopServerResult.OK &&
				this.status === 'online'
			) {
				await this.forceStopAndSettle();
			}
		} catch ( error ) {
			if ( this.settled ) {
				return;
			}

			this.errorToConsole( `Error handling message ${ message.topic }:`, error );
			await this.emitMessage( this.createErrorMessage( message.messageId, error ) );
			this.errorToConsole( 'Killing process because of', error );
			await this.forceStopAndSettle();
		} finally {
			delete this.abortControllers[ message.messageId ];
		}
	}

	private async startServer(
		config: Parameters< NativePhpRuntime[ 'startServer' ] >[ 0 ],
		signal: AbortSignal
	): Promise< void > {
		if ( this.serverProcess && isChildRunning( this.serverProcess ) ) {
			this.logToConsole( `Server already running for site ${ config.siteId }` );
			return;
		}

		if ( ! this.startingPromise ) {
			this.startupAbortController = new AbortController();
			const stopSignal = AbortSignal.any( [ signal, this.startupAbortController.signal ] );
			this.startingPromise = this.runtime
				.startServer( config, stopSignal )
				.then( ( serverProcess ) => {
					this.serverProcess = serverProcess;
					this.attachServerExitHandler( serverProcess );
				} )
				.catch( async ( error ) => {
					await this.forceStop();
					throw error;
				} )
				.finally( () => {
					this.startingPromise = null;
					this.startupAbortController = null;
				} );
		}

		await this.startingPromise;
	}

	private async stopServer(): Promise< NativePhpStopServerResult > {
		if ( this.startupAbortController ) {
			this.logToConsole( 'Startup operation in progress. Aborting it to stop the server...' );
			this.startupAbortController.abort();
			return NativePhpStopServerResult.ABORTED_STARTUP;
		}

		if ( ! this.serverProcess ) {
			this.logToConsole( 'No server running, nothing to stop' );
			return NativePhpStopServerResult.OK;
		}

		if ( ! isChildRunning( this.serverProcess ) ) {
			this.logToConsole( 'Server already stopped' );
			this.detachServerExitHandler( this.serverProcess );
			this.serverProcess = null;
			return NativePhpStopServerResult.OK;
		}

		const child = this.serverProcess;
		this.serverProcess = null;
		this.detachServerExitHandler( child );

		await new Promise< void >( ( resolve ) => {
			const forceKillTimeout = setTimeout( () => {
				this.errorToConsole( 'PHP child did not exit in time; sending SIGKILL' );
				this.terminatePhpProcess( child, 'SIGKILL' );
			}, STOP_SERVER_TIMEOUT );

			child.once( 'exit', () => {
				clearTimeout( forceKillTimeout );
				resolve();
			} );

			this.terminatePhpProcess( child, 'SIGTERM' );
		} );

		this.logToConsole( 'Server stopped gracefully' );
		return NativePhpStopServerResult.OK;
	}

	private attachServerExitHandler( child: ChildProcess ): void {
		this.detachServerExitHandler();
		this.serverExitHandler = ( code, signal ) => {
			if ( this.serverProcess === child ) {
				this.serverProcess = null;
			}
			this.errorToConsole(
				`PHP child process exited unexpectedly (code: ${ code }, signal: ${ signal })`
			);
			void this.forceStopAndSettle();
		};
		child.once( 'exit', this.serverExitHandler );
	}

	private detachServerExitHandler( child = this.serverProcess ): void {
		if ( child && this.serverExitHandler ) {
			child.off( 'exit', this.serverExitHandler );
		}
		this.serverExitHandler = null;
	}

	private trackPhpProcess( child: ChildProcess ): void {
		this.activePhpProcesses.add( child );
		const forgetProcess = () => {
			this.activePhpProcesses.delete( child );
		};
		child.once( 'close', forgetProcess );
		child.once( 'error', forgetProcess );
	}

	private terminatePhpProcess( child: ChildProcess, signal: NodeJS.Signals ): void {
		if ( ! isChildRunning( child ) ) {
			return;
		}

		try {
			child.kill( signal );
		} catch {
			// Best effort. The process may already be gone.
		}
	}

	private async waitForChildExit( child: ChildProcess ): Promise< void > {
		if ( hasChildExited( child ) ) {
			return;
		}

		await new Promise< void >( ( resolve ) => {
			child.once( 'exit', () => resolve() );
		} );
	}

	private createResultMessage( messageId: string, result: unknown ): ChildMessageRaw {
		return {
			originalMessageId: messageId,
			topic: 'result',
			result,
		};
	}

	private createErrorMessage( messageId: string, error: unknown ): ChildMessageRaw {
		return {
			originalMessageId: messageId,
			topic: 'error',
			errorMessage: error instanceof Error ? error.message : String( error ),
			errorStack: error instanceof Error ? error.stack : undefined,
		};
	}

	private async forceStopAndSettle(): Promise< void > {
		await this.forceStop();
		await this.settleAndEmitExit();
	}

	private logToConsole( ...args: Parameters< typeof console.log > ) {
		this.emitFormattedLine( 'stdout', '[PHP Server]', ...args );
	}

	private errorToConsole( ...args: Parameters< typeof console.error > ) {
		this.emitFormattedLine( 'stderr', '[PHP Server]', ...args );
	}

	private emitFormattedLine(
		target: 'stdout' | 'stderr',
		prefix: string,
		...args: unknown[]
	): void {
		const writeLine = target === 'stdout' ? this.writeStdoutLine : this.writeStderrLine;

		for ( const line of splitLogMessage( `${ prefix } ${ format( ...args ) }` ) ) {
			writeLine.call( this, line );
		}
	}
}
