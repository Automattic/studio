import fs from 'fs';
import http from 'node:http';
import https from 'node:https';
import type { CpanelSyncSite } from 'src/modules/cpanel/types';

type UapiResponse< T = unknown > = {
	status: number;
	data: T;
	errors: string[] | null;
	messages: string[] | null;
};

/**
 * Make a cPanel UAPI call.
 * GET for reads, POST for writes (compression, deletion, etc.).
 */
export async function cpanelUapi< T = unknown >(
	site: Pick< CpanelSyncSite, 'hostname' | 'port' | 'username' | 'apiToken' >,
	module: string,
	fn: string,
	params: Record< string, string > = {},
	method: 'GET' | 'POST' = 'GET'
): Promise< T > {
	const baseUrl = `https://${ site.hostname }:${ site.port }/execute/${ module }/${ fn }`;
	const authHeader = `cpanel ${ site.username }:${ site.apiToken }`;

	let url: string;
	let postBody: string | undefined;

	if ( method === 'POST' ) {
		url = baseUrl;
		postBody = new URLSearchParams( params ).toString();
	} else {
		const qs = new URLSearchParams( params ).toString();
		url = qs ? `${ baseUrl }?${ qs }` : baseUrl;
	}

	const parsedUrl = new URL( url );
	const isHttps = parsedUrl.protocol === 'https:';
	const httpModule = isHttps ? https : http;

	const requestOptions: https.RequestOptions = {
		hostname: parsedUrl.hostname,
		port: parsedUrl.port ? parseInt( parsedUrl.port ) : isHttps ? 443 : 80,
		path: parsedUrl.pathname + parsedUrl.search,
		method,
		headers: {
			Authorization: authHeader,
			Accept: 'application/json',
			...( method === 'POST' ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {} ),
		},
		// Tolerate self-signed certs on cPanel instances (common on shared hosting)
		rejectUnauthorized: false,
	};

	const responseText = await new Promise< string >( ( resolve, reject ) => {
		const req = httpModule.request( requestOptions, ( res ) => {
			let data = '';
			res.on( 'data', ( chunk: string ) => {
				data += chunk;
			} );
			res.on( 'end', () => {
				if ( res.statusCode && res.statusCode >= 400 ) {
					reject(
						new Error( `cPanel UAPI request failed: ${ res.statusCode } ${ res.statusMessage }` )
					);
					return;
				}
				resolve( data );
			} );
			res.on( 'error', reject );
		} );

		req.on( 'error', reject );

		if ( postBody ) {
			req.write( postBody );
		}

		req.end();
	} );

	const parsed: UapiResponse< T > = JSON.parse( responseText );

	if ( ! parsed.status ) {
		const errorMsg = parsed.errors?.join( '; ' ) || 'Unknown cPanel UAPI error';
		throw new Error( `cPanel UAPI ${ module }::${ fn } failed: ${ errorMsg }` );
	}

	return parsed.data as T;
}

/**
 * Retrieve the SQL dump of a database via UAPI.
 * The response body is the raw SQL, not JSON-wrapped.
 */
export async function cpanelDumpDatabase(
	site: Pick< CpanelSyncSite, 'hostname' | 'port' | 'username' | 'apiToken' >,
	dbName: string
): Promise< string > {
	const url = `https://${ site.hostname }:${
		site.port
	}/execute/Mysql/dump_database_schema?dbname=${ encodeURIComponent( dbName ) }`;
	const authHeader = `cpanel ${ site.username }:${ site.apiToken }`;

	const parsedUrl = new URL( url );

	const requestOptions: https.RequestOptions = {
		hostname: parsedUrl.hostname,
		port: parsedUrl.port ? parseInt( parsedUrl.port ) : 443,
		path: parsedUrl.pathname + parsedUrl.search,
		method: 'GET',
		headers: {
			Authorization: authHeader,
		},
		rejectUnauthorized: false,
	};

	return new Promise< string >( ( resolve, reject ) => {
		const req = https.request( requestOptions, ( res ) => {
			if ( res.statusCode && res.statusCode >= 400 ) {
				reject(
					new Error( `cPanel database dump failed: ${ res.statusCode } ${ res.statusMessage }` )
				);
				return;
			}

			let data = '';
			res.on( 'data', ( chunk: string ) => {
				data += chunk;
			} );
			res.on( 'end', () => resolve( data ) );
			res.on( 'error', reject );
		} );

		req.on( 'error', reject );
		req.end();
	} );
}

/**
 * Download a file from cPanel's file manager download URL.
 * This is an undocumented but widely available endpoint on cPanel servers.
 *
 * Note: `dir` is the directory containing the file (relative to cPanel home),
 * `filename` is just the filename portion.
 */
export async function cpanelDownloadFile(
	site: Pick< CpanelSyncSite, 'hostname' | 'port' | 'username' | 'apiToken' >,
	dir: string,
	filename: string,
	destPath: string,
	signal?: AbortSignal
): Promise< void > {
	const url = `https://${ site.hostname }:${
		site.port
	}/download?skipencode=1&dir=${ encodeURIComponent( dir ) }&file=${ encodeURIComponent(
		filename
	) }`;
	const authHeader = `cpanel ${ site.username }:${ site.apiToken }`;
	const parsedUrl = new URL( url );

	const requestOptions: https.RequestOptions = {
		hostname: parsedUrl.hostname,
		port: parsedUrl.port ? parseInt( parsedUrl.port ) : 443,
		path: parsedUrl.pathname + parsedUrl.search,
		method: 'GET',
		headers: {
			Authorization: authHeader,
		},
		rejectUnauthorized: false,
	};

	await new Promise< void >( ( resolve, reject ) => {
		const outStream = fs.createWriteStream( destPath );

		const req = https.request( requestOptions, ( res ) => {
			if ( res.statusCode && res.statusCode >= 400 ) {
				outStream.close();
				reject(
					new Error( `cPanel file download failed: ${ res.statusCode } ${ res.statusMessage }` )
				);
				return;
			}

			res.pipe( outStream );
			outStream.on( 'finish', () => outStream.close( () => resolve() ) );
			res.on( 'error', ( err ) => {
				outStream.close();
				reject( err );
			} );
		} );

		req.on( 'error', ( err ) => {
			outStream.close();
			reject( err );
		} );

		if ( signal ) {
			signal.addEventListener( 'abort', () => {
				req.destroy();
				outStream.close();
				fs.unlink( destPath, () => {} );
				reject( new Error( 'Download aborted' ) );
			} );
		}

		req.end();
	} );
}

/**
 * Delete a file on the cPanel server (used for cleanup after pull).
 */
export async function cpanelDeleteFile(
	site: Pick< CpanelSyncSite, 'hostname' | 'port' | 'username' | 'apiToken' >,
	dir: string,
	filename: string
): Promise< void > {
	await cpanelUapi(
		site,
		'Fileman',
		'delete_files',
		{
			'files-0': `${ dir }/${ filename }`,
		},
		'POST'
	);
}
