import path from 'node:path';
import { createApp } from './app.ts';
import { loadConfig } from './config.ts';
import { fileStore } from './store.ts';
import { fakeClient, previewClient } from './wpcom.ts';

const log = ( event: string, data: Record< string, unknown > = {} ) =>
	console.log( JSON.stringify( { time: new Date().toISOString(), event, ...data } ) );

const config = loadConfig();
if ( ! config.fakePipeline && ! config.wpcom ) {
	throw new Error(
		'Set WPCOM_CLIENT_ID and WPCOM_CLIENT_SECRET, or LIBERATE_FAKE_PIPELINE=1 to simulate captures.'
	);
}

const store = fileStore( path.join( config.dataDir, 'jobs' ) );
const client = config.fakePipeline ? fakeClient() : previewClient( config );
const prune = async () => log( 'pruned', { records: await store.prune() } );
await prune();
const sweeper = setInterval( () => void prune(), 60 * 60_000 );

const app = await createApp( { config, store, client, log } );
const server = app.listen( config.port, () =>
	log( 'listening', { port: config.port, dataDir: config.dataDir, fake: config.fakePipeline } )
);

const stop = ( signal: string ) => {
	log( 'stopping', { signal } );
	clearInterval( sweeper );
	server.close();
	server.closeAllConnections();
};
process.on( 'SIGTERM', () => stop( 'SIGTERM' ) );
process.on( 'SIGINT', () => stop( 'SIGINT' ) );
