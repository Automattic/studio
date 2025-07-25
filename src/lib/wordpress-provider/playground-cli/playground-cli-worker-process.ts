import { utilityProcess } from 'electron';
import type { Blueprint } from '@wp-playground/blueprints';

// This constant is defined by webpack
declare const PLAYGROUND_CLI_WORKER_MODULE_PATH: string;

export interface WorkerConfig {
	command: 'run-blueprint';
	blueprint: Blueprint;
	hostPath: string;
	port?: number;
	wpVersion?: string;
	phpVersion?: string;
	skipWordPressSetup?: boolean;
}

export class PlaygroundCliWorkerProcess {
	async runBlueprint( config: WorkerConfig ): Promise< { success: boolean; error?: string } > {
		console.log( '[playground-cli-worker-process] Starting utility process' );

		return new Promise( ( resolve ) => {
			const workerProcess = utilityProcess.fork( PLAYGROUND_CLI_WORKER_MODULE_PATH, [], {
				serviceName: 'studio-playground-cli-worker',
				env: {
					...process.env,
				},
			} );

			workerProcess.on( 'message', ( message: unknown ) => {
				const msg = message as { type?: string };

				// Handle ready message - send the blueprint request
				if ( msg.type === 'ready' ) {
					console.log( '[playground-cli-worker-process] Worker ready, sending blueprint request' );
					workerProcess.postMessage( { id: 0, type: 'run-blueprint', data: config } );
					return;
				}

				console.log( '[playground-cli-worker-process] Received message:', msg );
			} );

			workerProcess.on( 'exit', ( code ) => {
				console.log( `[playground-cli-worker-process] Process exited with code: ${ code }` );

				// Clean up after exit
				setTimeout( () => {
					// Ensure the process is fully terminated
					try {
						workerProcess.kill();
						console.log( '[playground-cli-worker-process] Force killed worker process after exit' );
					} catch ( e ) {
						// Process already terminated
					}
				}, 100 );

				// The playground CLI exits with code 0 on success, non-zero on failure
				if ( code === 0 ) {
					resolve( { success: true } );
				} else {
					resolve( {
						success: false,
						error: `Process exited with code ${ code }`,
					} );
				}
			} );

			workerProcess.on( 'spawn', () => {
				console.log( '[playground-cli-worker-process] Worker process spawned' );
			} );

			workerProcess.on( 'error', ( error ) => {
				console.error( '[playground-cli-worker-process] Process error:', error );
				workerProcess.kill();
				resolve( {
					success: false,
					error: String( error ),
				} );
			} );
		} );
	}
}
