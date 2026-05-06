import { ChildProcess, spawn } from 'child_process';
import semver from 'semver';
import { ManagerMessage } from 'cli/lib/types/wordpress-server-ipc';
import { ManagedProcessCallbacks } from './managed-process';
import { ManagedProcessBase } from './managed-process-base';

const STOP_TIMEOUT_MS = 2_500;

type NodeManagedProcessOptions = {
	pmId: number;
	name: string;
	scriptPath: string;
	env?: NodeJS.ProcessEnv;
	args?: string[];
	callbacks: ManagedProcessCallbacks;
};

export abstract class ManagedProcessNode extends ManagedProcessBase {
	private child: ChildProcess | null = null;
	private readonly scriptPath: string;
	private readonly env: NodeJS.ProcessEnv;
	private readonly args: string[];

	constructor( {
		pmId,
		name,
		scriptPath,
		env = process.env,
		args = [],
		callbacks,
	}: NodeManagedProcessOptions ) {
		super( pmId, name, callbacks );
		this.scriptPath = scriptPath;
		this.env = env;
		this.args = args;
	}

	async start(): Promise< void > {
		const doesCurrentNodeSupportJspi = semver.gte( process.version, '24.0.0' );
		const execArgv = doesCurrentNodeSupportJspi ? [ '--experimental-wasm-jspi' ] : [];
		const child = spawn( process.execPath, [ ...execArgv, this.scriptPath, ...this.args ], {
			env: this.env,
			stdio: [ 'ignore', 'pipe', 'pipe', 'ipc' ],
			windowsHide: true,
		} );
		this.child = child;
		this.currentPid = child.pid as number;
		this.currentStatus = 'online';

		this.pipeOutputWithTimestamp( child.stdout, ( line ) => {
			this.writeStdoutLine( line );
		} );
		this.pipeOutputWithTimestamp( child.stderr, ( line ) => {
			this.writeStderrLine( line );
		} );

		child.on( 'message', ( raw ) => {
			void this.emitMessage( raw );
		} );

		child.on( 'error', ( error ) => {
			this.writeStderrText( error.stack ?? error.message );
			void this.settleAndEmitExit();
		} );

		child.on( 'exit', () => {
			void this.settleAndEmitExit();
		} );

		await this.emitEvent( { event: 'online' } );
	}

	async stop(): Promise< void > {
		if ( ! this.child || this.status !== 'online' ) {
			return;
		}

		await new Promise< void >( ( resolve ) => {
			const timeoutId = setTimeout( () => {
				this.signalChildProcess( 'SIGKILL' );
			}, STOP_TIMEOUT_MS );

			this.child?.once( 'exit', () => {
				clearTimeout( timeoutId );
				void this.emitEvent( { event: 'delete' } );
				resolve();
			} );

			this.signalChildProcess( 'SIGTERM' );
		} );
	}

	forceStop(): void {
		this.signalChildProcess( 'SIGKILL' );
	}

	async sendMessage( message: ManagerMessage ): Promise< void > {
		if ( ! this.child ) {
			throw new Error( `Process with id ${ this.pmId } is not started` );
		}

		if ( ! this.child.connected ) {
			throw new Error( `Process with id ${ this.pmId } is not connected` );
		}

		await new Promise< void >( ( resolve, reject ) => {
			this.child?.send( message, ( error ) => {
				if ( error ) {
					reject( error );
					return;
				}
				resolve();
			} );
		} );
	}

	private signalChildProcess( signal: NodeJS.Signals ): void {
		if ( ! this.child?.pid ) {
			return;
		}

		try {
			this.child.kill( signal );
		} catch {
			// Best effort. The process may already be gone.
		}
	}
}
