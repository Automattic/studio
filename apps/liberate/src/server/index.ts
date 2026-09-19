import path from 'node:path';
import { createApp } from './app.ts';
import { loadConfig } from './config.ts';
import { JobQueue } from './jobs.ts';
import { createPipeline, fakePipeline, prepareStudio } from './pipeline.ts';

const log = ( event: string, data: Record< string, unknown > = {} ) =>
	console.log( JSON.stringify( { time: new Date().toISOString(), event, ...data } ) );

const config = loadConfig();
if ( ! config.fakePipeline ) {
	await prepareStudio( config );
}

const queue = new JobQueue( {
	dir: path.join( config.dataDir, 'jobs' ),
	run: config.fakePipeline ? fakePipeline : createPipeline( config, log ),
	concurrency: config.concurrency,
	maxQueued: config.maxQueued,
	timeoutMs: config.timeoutMs,
	retentionMs: config.retentionMs,
	log,
} );
await queue.load();
await queue.sweep();
const sweeper = setInterval( () => void queue.sweep(), 10 * 60_000 );

const app = await createApp( { config, queue, log } );
const server = app.listen( config.port, () =>
	log( 'listening', { port: config.port, dataDir: config.dataDir, fake: config.fakePipeline } )
);

let stopping = false;
const stop = async ( signal: string ) => {
	if ( stopping ) {
		return;
	}
	stopping = true;
	log( 'stopping', { signal } );
	clearInterval( sweeper );
	server.close();
	// Open progress streams would keep the server alive; clients reconnect on their own.
	server.closeAllConnections();
	await queue.shutdown();
	process.exit( 0 );
};
process.on( 'SIGTERM', () => void stop( 'SIGTERM' ) );
process.on( 'SIGINT', () => void stop( 'SIGINT' ) );
