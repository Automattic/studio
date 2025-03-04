import { performance } from 'perf_hooks';
import { HTTPMethod, PHPRequest } from '@php-wasm/universal';
import compression from 'compression';
import express from 'express';
import fs from 'fs-extra';
// import { EventLoopTester } from 'vendor/wp-now/src/event-loop-tester';
import { WPNowOptions } from './config';
import { output } from './output';
import { PHPWorkerPool } from './php-worker-pool';
import { portFinder } from './port-finder';

export interface WPNowServer {
	url: string;
	phpWorkerPool: PHPWorkerPool;
	options: WPNowOptions;
	stopServer: () => Promise< void >;
}

// @TODO Review this func again
// Simple compression middleware
const shouldCompress = ( req, res ) => {
	if ( req.headers[ 'x-no-compression' ] ) {
		return false;
	}
	return compression.filter( req, res );
};

const requestBodyToBytes = async ( req ): Promise< Uint8Array > =>
	await new Promise( ( resolve ) => {
		const body = [];
		req.on( 'data', ( chunk ) => {
			body.push( chunk );
		} );
		req.on( 'end', () => {
			resolve( Buffer.concat( body ) );
		} );
	} );

export async function startServer( options: WPNowOptions = {} ): Promise< WPNowServer > {
	if ( ! fs.existsSync( options.projectPath ) ) {
		throw new Error( `The given path "${ options.projectPath }" does not exist.` );
	}

	// const tester = new EventLoopTester( 1000, 'FakeWorker' );
	// tester.start();

	const app = express();
	// app.use( compression( { filter: shouldCompress } ) );
	// app.use( ( req, res, next ) => {
	// 	if ( req.path.startsWith( '/wp-admin' ) && ! req.path.endsWith( '/' ) ) {
	// 		res.redirect( 301, req.path + '/' );
	// 	} else {
	// 		next();
	// 	}
	// } );
	const port = options.port ?? ( await portFinder.getOpenPort() );

	// Create worker pool
	const workerPool = new PHPWorkerPool( options );
	await workerPool.initialize();

	// Handle requests using worker pool
	app.all( '*', async ( req, res ) => {
		console.log( 'GOT ' + req.url );
		const sTime = performance.now();

		try {
			const requestHeaders = req.rawHeaders?.length
				? Object.fromEntries(
						Array.from( { length: req.rawHeaders.length / 2 }, ( _, i ) => i * 2 ).map( ( i ) => [
							req.rawHeaders[ i ].toLowerCase(),
							req.rawHeaders[ i + 1 ],
						] )
				  )
				: {};

			const data = {
				url: req.url,
				headers: requestHeaders,
				method: req.method as HTTPMethod,
				body: await requestBodyToBytes( req ),
			} as PHPRequest;

			// Add a timeout to prevent hanging requests
			const timeoutMs = 30000; // 30 seconds
			const timeoutPromise = new Promise( ( _, reject ) => {
				setTimeout( () => reject( new Error( 'Request timed out' ) ), timeoutMs );
			} );

			// Race the actual request against the timeout
			const resp = ( await Promise.race( [
				workerPool.handleRequest( data ),
				timeoutPromise,
			] ) ) as any;

			res.writeHead( resp.httpStatusCode, resp.headers );
			res.end( resp.bytes );

			const timeTaken = Number( ( performance.now() - sTime ).toFixed( 2 ) );
			console.log( 'req time:', req.method, req.url, timeTaken, 'ms' );
		} catch ( e ) {
			output?.trace( e );
			if ( ! res.headersSent ) {
				res.status( 500 ).send( 'Internal Server Error' );
			}
		}
	} );

	const server = app.listen( port, () => {
		output?.log( `Server running at ${ options.absoluteUrl }` );
	} );

	return {
		url: options.absoluteUrl,
		phpWorkerPool: workerPool,
		options,
		stopServer: () =>
			new Promise( ( res ) => {
				server.close( async () => {
					output?.log( `Server stopped` );
					await workerPool.shutdown();
					res();
				} );
			} ),
	};
}
