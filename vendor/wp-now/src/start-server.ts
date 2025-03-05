import { performance } from 'perf_hooks';
import { HTTPMethod, PHPRequest } from '@php-wasm/universal';
import compressible from 'compressible';
import compression from 'compression';
import express from 'express';
import fs from 'fs-extra';
import { addTrailingSlash } from 'vendor/wp-now/src/add-trailing-slash';
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

function shouldCompress( req, res ) {
	if ( req.headers[ 'x-no-compression' ] ) {
		return false;
	}

	const types = res.getHeader( 'content-type' );
	const type = Array.isArray( types ) ? types[ 0 ] : types;
	return type && compressible( type );
}

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

	const app = express();
	app.use( compression( { filter: shouldCompress } ) );
	app.use( addTrailingSlash( '/wp-admin' ) );
	const port = options.port ?? ( await portFinder.getOpenPort() );

	// Create worker pool
	const workerPool = new PHPWorkerPool( options );
	await workerPool.initialize();

	// Middleware to check if auto-login should be executed
	app.use( async ( req, res, next ) => {
		if ( req.query[ 'playground-auto-login' ] === 'true' ) {
			await workerPool.handleRequest( { url: '/wp-login.php' } );
			const response = await workerPool.handleRequest( {
				url: '/wp-login.php',
				method: 'POST',
				body: {
					log: 'admin',
					pwd: options.adminPassword,
					rememberme: 'forever',
				},
			} );
			const cookies = response.headers[ 'set-cookie' ];
			if ( cookies ) {
				res.setHeader( 'set-cookie', cookies );
			}
			// Remove query parameter to avoid infinite loop
			let redirectUrl = req.url.replace( /&?playground-auto-login=true/, '' );
			// If no more query parameters, remove ? from URL
			if ( Object.keys( req.query ).length === 1 ) {
				redirectUrl = redirectUrl.substring( 0, redirectUrl.length - 1 );
			}
			return res.redirect( redirectUrl );
		}
		next();
	} );

	// Handle requests using worker pool
	app.use( '/', async ( req, res ) => {
		console.log( 'GOT ' + req.url );
		const sTime = performance.now();

		try {
			const requestHeaders = {};
			if ( req.rawHeaders && req.rawHeaders.length ) {
				for ( let i = 0; i < req.rawHeaders.length; i += 2 ) {
					requestHeaders[ req.rawHeaders[ i ].toLowerCase() ] = req.rawHeaders[ i + 1 ];
				}
			}

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
