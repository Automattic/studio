import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { DEFAULT_PHP_VERSION } from '@studio/common/constants';
import { resolveNativePhpVersion } from '@studio/common/lib/php-binary-metadata';
import nock from 'nock';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getPhpBinaryPath } from 'cli/lib/dependency-management/paths';

const routerPath = path.resolve( import.meta.dirname, 'router.php' );
const phpBinaryPath = getPhpBinaryPath( resolveNativePhpVersion( DEFAULT_PHP_VERSION ) );
const assetContents = 'asset bytes with a literal plus';

let root: string;
let fixtureDirectory: string;
let baseUrl: string;
let server: ChildProcess;

async function getAvailablePort(): Promise< number > {
	return await new Promise( ( resolve, reject ) => {
		const socket = net.createServer();
		socket.once( 'error', reject );
		socket.listen( 0, '127.0.0.1', () => {
			const address = socket.address();
			if ( ! address || typeof address === 'string' ) {
				socket.close();
				reject( new Error( 'Could not allocate a port for PHP' ) );
				return;
			}

			socket.close( () => resolve( address.port ) );
		} );
	} );
}

async function waitForServer( url: string ): Promise< void > {
	const deadline = Date.now() + 5000;
	while ( Date.now() < deadline ) {
		try {
			await fetch( url );
			return;
		} catch {
			await new Promise( ( resolve ) => setTimeout( resolve, 25 ) );
		}
	}

	throw new Error( 'PHP server did not start' );
}

async function request( requestPath: string ): Promise< { status: number; body: string } > {
	return await new Promise( ( resolve, reject ) => {
		http
			.get( `${ baseUrl }${ requestPath }`, ( response ) => {
				let body = '';
				response.setEncoding( 'utf8' );
				response.on( 'data', ( chunk ) => ( body += chunk ) );
				response.on( 'end', () => resolve( { status: response.statusCode ?? 0, body } ) );
			} )
			.on( 'error', reject );
	} );
}

describe( 'native PHP router', { tags: [ 'e2e' ] }, () => {
	beforeAll( async () => {
		nock.enableNetConnect( '127.0.0.1' );
		fixtureDirectory = fs.mkdtempSync( path.join( os.tmpdir(), 'studio-php-router-' ) );
		root = path.join( fixtureDirectory, 'site' );
		fs.mkdirSync( root );
		fs.writeFileSync( path.join( root, 'logo+large.gif' ), assetContents );
		fs.writeFileSync( path.join( root, 'asset with spaces.gif' ), 'space asset bytes' );
		fs.writeFileSync( path.join( root, 'index.php' ), '<?php http_response_code( 404 );' );
		fs.writeFileSync( path.join( fixtureDirectory, 'secret.txt' ), 'must not be served' );

		const port = await getAvailablePort();
		baseUrl = `http://127.0.0.1:${ port }`;
		server = spawn( phpBinaryPath, [ '-S', `127.0.0.1:${ port }`, routerPath ], {
			cwd: root,
			stdio: 'ignore',
		} );
		await waitForServer( baseUrl );
	} );

	afterAll( () => {
		server.kill();
		fs.rmSync( fixtureDirectory, { recursive: true, force: true } );
	} );

	it.each( [ '/logo+large.gif', '/logo%2Blarge.gif', '/logo%2Blarge.gif?cache=1' ] )(
		'serves literal and encoded plus signs without changing asset bytes: %s',
		async ( requestPath ) => {
			const response = await request( requestPath );

			expect( response ).toEqual( { status: 200, body: assetContents } );
		}
	);

	it( 'serves percent-encoded spaces', async () => {
		expect( await request( '/asset%20with%20spaces.gif' ) ).toEqual( {
			status: 200,
			body: 'space asset bytes',
		} );
	} );

	it( 'does not serve files outside the document root through an encoded traversal path', async () => {
		const response = await request( '/..%2Fsecret.txt' );

		expect( response.body ).not.toBe( 'must not be served' );
		expect( response.status ).not.toBe( 200 );
	} );
} );
