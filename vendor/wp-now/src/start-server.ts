import fs from 'fs';
import { HTTPMethod, PHP } from '@php-wasm/universal';
import compressible from 'compressible';
import compression from 'compression';
import express from 'express';
import { addTrailingSlash } from './add-trailing-slash';
import { WPNowOptions } from './config';
import { LoadBalancer } from './load-balancer';
import { output } from './output';
import { portFinder } from './port-finder';
import startWPNow from './wp-now';

class EventLoopTester {
	private readonly intervalMs: number;
	private readonly label: string;
	private isRunning: boolean;
	private startTime: number;
	private iterationCount: number;
	constructor( intervalMs = 1000, label = 'EventLoopTester' ) {
		this.intervalMs = intervalMs;
		this.label = label;
		this.isRunning = false;
		this.startTime = null;
		this.iterationCount = 0;
	}

	start() {
		if ( this.isRunning ) {
			console.warn( `${ this.label }: Already running` );
			return;
		}

		this.isRunning = true;
		this.startTime = Date.now();
		this.iterationCount = 0;

		const tick = () => {
			if ( ! this.isRunning ) return;

			this.iterationCount++;
			const elapsedTime = Date.now() - this.startTime;
			// console.log(
			// 	`${ this.label }: Iteration ${ this.iterationCount } at ${ elapsedTime }ms ` +
			// 		`(expected: ${ this.iterationCount * this.intervalMs }ms, ` +
			// 		`drift: ${ elapsedTime - this.iterationCount * this.intervalMs }ms)`
			// );

			console.log( '🫥' + elapsedTime );

			setTimeout( tick, this.intervalMs );
		};

		console.log( `${ this.label }: Starting event loop tester` );
		setTimeout( tick, this.intervalMs );
	}

	stop() {
		if ( ! this.isRunning ) {
			console.warn( `${ this.label }: Not running` );
			return;
		}

		this.isRunning = false;
		console.log( `${ this.label }: Stopped after ${ this.iterationCount } iterations` );
	}
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

export interface WPNowServer {
	url: string;
	loadBalancer: LoadBalancer;
	options: WPNowOptions;
	php: PHP;
	stopServer: () => Promise< void >;
}

function shouldCompress( _, res ) {
	const types = res.getHeader( 'content-type' );
	const type = Array.isArray( types ) ? types[ 0 ] : types;
	return type && compressible( type );
}

export async function startServer( options: WPNowOptions = {} ): Promise< WPNowServer > {
	if ( ! fs.existsSync( options.projectPath ) ) {
		throw new Error( `The given path "${ options.projectPath }" does not exist.` );
	}

	const tester = new EventLoopTester( 100, 'FakeWorker' );
	tester.start();

	const app = express();
	app.use( compression( { filter: shouldCompress } ) );
	app.use( addTrailingSlash( '/wp-admin' ) );
	const port = options.port ?? ( await portFinder.getOpenPort() );

	// @TODO: add back middleware to check if auto-login should be executed

	// First create a primary PHP instance
	const { php: primaryPhp, options: primaryOptions } = await startWPNow( options );
	// @TODO: undo
	// const numInstances = options.numberOfPhpInstances || 6;
	const numInstances = 6;

	const phpServers: WPNowServer[] = [
		{
			url: options.absoluteUrl,
			php: primaryPhp,
			options: primaryOptions,
			loadBalancer: null!,
			stopServer: async () => {
				primaryPhp.exit();
			},
		},
	];

	console.log( 'Starting this many PHP instances:', numInstances );

	// Create additional PHP instances if needed
	for ( let i = 1; i < numInstances; i++ ) {
		const { php, options: wpNowOptions } = await startWPNow( {
			...options,
			port: port + i,
			// isPrimaryInstance: false
		} );

		const server: WPNowServer = {
			url: options.absoluteUrl,
			php,
			options: wpNowOptions,
			loadBalancer: null!,
			stopServer: async () => {
				php.exit();
			},
		};
		phpServers.push( server );
	}

	const loadBalancer = new LoadBalancer( phpServers );
	phpServers.forEach( ( server ) => {
		server.loadBalancer = loadBalancer;
	} );

	// Handle requests using load balancer
	app.use( '/', ( req, res ) => {
		console.log( 'GOT ' + req.url );
		// Process each request in its own async context without awaiting
		processRequest( req, res, loadBalancer ).catch( ( e ) => {
			output?.trace( e );
			if ( ! res.headersSent ) {
				res.status( 500 ).send( 'Internal Server Error' );
			}
		} );
	} );

	// Log load balancer stats periodically
	setInterval( () => {
		console.log( 'Load Balancer Stats:' );
		console.log( loadBalancer.getServerStats() );
	}, 3000 );

	// Separate function to handle the request processing
	async function processRequest( req, res, loadBalancer ) {
		const server = loadBalancer.getNextServer();
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
			};

			const resp = await server.php.requestHandler.request( data );
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
	}

	const server = app.listen( port, () => {
		output?.log( `Server running at ${ options.absoluteUrl }` );
	} );

	return {
		url: options.absoluteUrl,
		loadBalancer,
		options,
		php: phpServers[ 0 ].php,
		stopServer: () =>
			new Promise( ( res ) => {
				server.close( async () => {
					output?.log( `Server stopped` );
					await loadBalancer.stopAll();
					res();
				} );
			} ),
	};
}
