import fs from 'fs';
import { HTTPMethod, PHP } from '@php-wasm/universal';
import compressible from 'compressible';
import compression from 'compression';
import express from 'express';
import { addTrailingSlash } from './add-trailing-slash';
import { WPNowOptions } from './config';
import { EmailServer } from './email-server';
import { output } from './output';
import { portFinder } from './port-finder';
import startWPNow from './wp-now';

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
	php: PHP;
	options: WPNowOptions;
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
	console.log( '>>>>>>>>>>>>>>>>>> Starting server with options', options );
	const app = express();
	app.use( compression( { filter: shouldCompress } ) );
	app.use( addTrailingSlash( '/wp-admin' ) );
	const port = options.port ?? ( await portFinder.getOpenPort() );
	const { php, options: wpNowOptions } = await startWPNow( options );

	// Middleware to check if auto-login should be executed
	app.use( async ( req, res, next ) => {
		if ( req.query[ 'playground-auto-login' ] === 'true' ) {
			await php.requestHandler.request( { url: '/wp-login.php' } );
			const response = await php.requestHandler.request( {
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

	// Email server route handler.
	await EmailServer.registerRoutes( app, {
		user: options.emailUsername,
		pass: options.emailPassword,
		smtp: { host: options.emailHost, port: options.emailPort, secure: options.emailSecure },
	} );

	// Handle requests
	app.use( '/', async ( req, res ) => {
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
			};
			const resp = await php.requestHandler.request( data );
			res.statusCode = resp.httpStatusCode;
			Object.keys( resp.headers ).forEach( ( key ) => {
				res.setHeader( key, resp.headers[ key ] );
			} );
			res.end( resp.bytes );
		} catch ( e ) {
			output?.trace( e );
		}
	} );
	const url = options.absoluteUrl;
	const server = app.listen( port, () => {
		output?.log( `Server running at ${ url }` );
	} );

	return {
		url,
		php,
		options: wpNowOptions,
		stopServer: () =>
			new Promise( ( res ) => {
				server.close( () => {
					output?.log( `Server stopped` );
					php.exit();
					res();
				} );
			} ),
	};
}
