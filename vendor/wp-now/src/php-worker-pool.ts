import { Worker } from 'worker_threads';
import { PHPRequest, PHPResponse } from '@php-wasm/universal';
import { WPNowOptions } from 'vendor/wp-now/src/config';

export class PHPWorkerPool {
	private workers: Worker[] = [];
	private readyWorkers: Set< number > = new Set();
	private requestQueue: Array< {
		resolve: ( value: PHPResponse ) => void;
		reject: ( error: any ) => void;
		request: PHPRequest;
	} > = [];
	private nextRequestId = 0;
	private pendingRequests = new Map<
		number,
		{
			resolve: ( value: PHPResponse ) => void;
			reject: ( error: any ) => void;
		}
	>();

	constructor(
		private options: WPNowOptions,
		private numWorkers: number
	) {}

	async initialize() {
		for ( let i = 0; i < this.numWorkers; i++ ) {
			const worker = new Worker( __filename, {
				workerData: { options: this.options, workerId: i },
			} );

			worker.on( 'message', ( data ) => {
				if ( data.type === 'ready' ) {
					this.readyWorkers.add( data.workerId );
					this.processQueue();
				} else if ( data.requestId !== undefined ) {
					const pending = this.pendingRequests.get( data.requestId );
					if ( pending ) {
						if ( data.success ) {
							pending.resolve( data.response );
						} else {
							pending.reject( new Error( data.error ) );
						}
						this.pendingRequests.delete( data.requestId );
						this.readyWorkers.add( data.workerId );
						this.processQueue();
					}
				}
			} );

			worker.on( 'error', ( error ) => {
				console.error( `Worker ${ i } error:`, error );
			} );

			this.workers[ i ] = worker;
		}

		// Wait for all workers to be ready
		await Promise.all(
			this.workers.map(
				( _, index ) =>
					new Promise< void >( ( resolve ) => {
						const checkReady = () => {
							if ( this.readyWorkers.has( index ) ) {
								resolve();
							} else {
								setTimeout( checkReady, 100 );
							}
						};
						checkReady();
					} )
			)
		);
	}

	async handleRequest( request: any ): Promise< any > {
		return new Promise( ( resolve, reject ) => {
			this.requestQueue.push( { resolve, reject, request } );
			this.processQueue();
		} );
	}

	private processQueue() {
		while ( this.requestQueue.length > 0 && this.readyWorkers.size > 0 ) {
			const workerId = Array.from( this.readyWorkers )[ 0 ];
			this.readyWorkers.delete( workerId );

			const { resolve, reject, request } = this.requestQueue.shift()!;
			const requestId = this.nextRequestId++;

			this.pendingRequests.set( requestId, { resolve, reject } );
			this.workers[ workerId ].postMessage( { requestId, request } );
		}
	}

	async shutdown() {
		await Promise.all( this.workers.map( ( worker ) => worker.terminate() ) );
		this.workers = [];
		this.readyWorkers.clear();
	}
}
