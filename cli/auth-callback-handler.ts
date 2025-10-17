#!/usr/bin/env node

import fs from 'fs';
import https from 'https';
import os from 'os';
import path from 'path';
import { URL } from 'url';

interface UserInfo {
	ID: number;
	email: string;
	display_name?: string;
}

interface AuthData {
	access_token: string;
	expires_in?: number;
}

function getAppdataDirectory(): string {
	if ( process.platform === 'win32' ) {
		if ( ! process.env.APPDATA ) {
			throw new Error( 'Studio config file path not found.' );
		}
		return path.join( process.env.APPDATA, 'Studio' );
	}
	return path.join( os.homedir(), 'Library', 'Application Support', 'Studio' );
}

function getAppdataPath(): string {
	const appdataDir = getAppdataDirectory();
	return path.join( appdataDir, 'appdata-v1.json' );
}

function parseAuthCallbackUrl( callbackUrl: string ): AuthData {
	try {
		const url = new URL( callbackUrl );
		const params = new URLSearchParams( url.hash.replace( '#', '?' ) );

		const accessToken = params.get( 'access_token' );
		const expiresIn = params.get( 'expires_in' );

		if ( ! accessToken ) {
			throw new Error( 'Missing access token' );
		}

		return {
			access_token: accessToken,
			expires_in: expiresIn ? parseInt( expiresIn, 10 ) : undefined,
		};
	} catch ( error ) {
		const message = error instanceof Error ? error.message : 'Unknown error';
		throw new Error( `Invalid authentication callback URL: ${ message }` );
	}
}

function fetchUserInfo( accessToken: string ): Promise< UserInfo > {
	return new Promise( ( resolve, reject ) => {
		const options = {
			hostname: 'public-api.wordpress.com',
			path: '/rest/v1/me?fields=ID,email,display_name',
			method: 'GET',
			headers: {
				Authorization: `Bearer ${ accessToken }`,
				'User-Agent': 'Studio CLI',
			},
		};

		const req = https.request( options, ( res ) => {
			let data = '';

			res.on( 'data', ( chunk ) => {
				data += chunk;
			} );

			res.on( 'end', () => {
				try {
					const response = JSON.parse( data );
					if ( res.statusCode !== 200 ) {
						reject( new Error( `API error: ${ response.message || 'Unknown error' }` ) );
						return;
					}
					resolve( response );
				} catch ( error ) {
					const message = error instanceof Error ? error.message : 'Unknown error';
					reject( new Error( `Failed to parse response: ${ message }` ) );
				}
			} );
		} );

		req.on( 'error', ( error ) => {
			reject( new Error( `Request failed: ${ error.message }` ) );
		} );

		req.end();
	} );
}

async function saveAuthenticationToken(
	accessToken: string,
	expiresIn: number | undefined,
	userInfo: UserInfo
): Promise< void > {
	const appDataPath = getAppdataPath();
	const appDataDir = path.dirname( appDataPath );

	// Ensure appdata directory exists
	await fs.promises.mkdir( appDataDir, { recursive: true } );

	let userData: {
		newSites: unknown[];
		sites: unknown[];
		snapshots: unknown[];
		version: number;
		authToken?: unknown;
	};
	try {
		const fileContent = await fs.promises.readFile( appDataPath, { encoding: 'utf8' } );
		userData = JSON.parse( fileContent );
	} catch {
		userData = {
			newSites: [],
			sites: [],
			snapshots: [],
			version: 1,
		};
	}

	const authToken = {
		accessToken: accessToken,
		id: userInfo.ID,
		email: userInfo.email,
		displayName: userInfo.display_name || '',
		expiresIn: expiresIn,
		expirationTime: expiresIn ? Date.now() + expiresIn * 1000 : undefined,
	};

	userData.authToken = authToken;

	const fileContent = JSON.stringify( userData, null, 2 ) + '\n';
	await fs.promises.writeFile( appDataPath, fileContent, { encoding: 'utf8' } );
}

async function main(): Promise< void > {
	try {
		const callbackUrl = process.argv[ 2 ];
		if ( ! callbackUrl ) {
			console.error( 'Usage: node auth-callback-handler.js <callback-url>' );
			process.exit( 1 );
		}

		console.log( 'Processing authentication callback…' );

		// Parse the callback URL to extract auth data
		const authData = parseAuthCallbackUrl( callbackUrl );

		console.log( 'Fetching user information…' );

		// Fetch user info from WordPress.com API
		const userInfo = await fetchUserInfo( authData.access_token );

		// Save the authentication token to appdata
		await saveAuthenticationToken( authData.access_token, authData.expires_in, userInfo );

		console.log( 'Authentication token saved successfully' );

		// Log user info
		if ( userInfo.email ) {
			console.log( 'Authenticated as:', userInfo.email );
		}
		if ( userInfo.display_name ) {
			console.log( 'Display name:', userInfo.display_name );
		}

		// Exit with success code
		process.exit( 0 );
	} catch ( error ) {
		const message = error instanceof Error ? error.message : 'Unknown error';
		console.error( 'Authentication callback failed:', message );
		process.exit( 1 );
	}
}

void main();
