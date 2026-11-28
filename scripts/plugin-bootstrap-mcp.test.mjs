import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import zlib from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const LAUNCHER = path.join(
	import.meta.dirname,
	'..',
	'plugins',
	'wp-studio',
	'scripts',
	'bootstrap-mcp.mjs'
);
// Newer than any Studio installed on the machine running the tests, so the
// launcher always falls back to the CLI the plugin carries.
const VERSION = '999.0.0';
const WINDOWS = process.platform === 'win32';

let tmp;
let pluginRoot;
let launcher;

// A published plugin, with a stand-in for the Studio CLI that says where it runs from.
beforeEach( () => {
	tmp = fs.realpathSync( fs.mkdtempSync( path.join( os.tmpdir(), 'studio-plugin-launcher-' ) ) );
	pluginRoot = path.join( tmp, 'plugin' );
	fs.mkdirSync( path.join( pluginRoot, 'scripts' ), { recursive: true } );
	launcher = path.join( pluginRoot, 'scripts', 'bootstrap-mcp.mjs' );
	fs.copyFileSync( LAUNCHER, launcher );
	fs.writeFileSync(
		path.join( pluginRoot, 'mcp-snapshot.json' ),
		JSON.stringify( {
			version: VERSION,
			home: '/snapshot-home',
			initialize: { capabilities: { tools: {} } },
			tools: { tools: [] },
			resources: { resources: [] },
		} )
	);
	const source = path.join( tmp, 'source' );
	fs.mkdirSync( path.join( source, 'cli' ), { recursive: true } );
	fs.writeFileSync(
		path.join( source, 'cli', 'main.mjs' ),
		`console.log( JSON.stringify( { method: 'started', params: { main: import.meta.filename } } ) );
process.stdin.resume();
`
	);
	const tarball = path.join( tmp, 'cli.tar' );
	execFileSync( WINDOWS ? path.join( process.env.SystemRoot, 'System32', 'tar.exe' ) : 'tar', [
		'-cf',
		tarball,
		'-C',
		source,
		'cli',
	] );
	fs.writeFileSync(
		path.join( pluginRoot, 'cli.tar.br' ),
		zlib.brotliCompressSync( fs.readFileSync( tarball ) )
	);
} );

afterEach( () => {
	if ( ! WINDOWS ) fs.chmodSync( pluginRoot, 0o755 );
	fs.rmSync( tmp, { recursive: true, force: true } );
} );

// Starts the launcher as an agent app would, and resolves with the path of the
// CLI it handed the session to.
async function start( env = {} ) {
	const home = path.join( tmp, 'home' );
	fs.mkdirSync( home, { recursive: true } );
	const server = spawn( process.execPath, [ launcher ], {
		env: {
			PATH: process.env.PATH,
			SystemRoot: process.env.SystemRoot,
			HOME: home,
			USERPROFILE: home,
			...env,
		},
		stdio: [ 'pipe', 'pipe', 'pipe' ],
	} );
	let stderr = '';
	server.stderr.on( 'data', ( chunk ) => ( stderr += chunk ) );
	try {
		return await new Promise( ( resolve, reject ) => {
			server.on( 'exit', ( code ) =>
				reject( new Error( `The launcher exited with code ${ code }: ${ stderr }` ) )
			);
			readline.createInterface( { input: server.stdout } ).on( 'line', ( line ) => {
				const message = JSON.parse( line );
				if ( message.method === 'started' ) resolve( message.params.main );
			} );
		} );
	} finally {
		server.removeAllListeners( 'exit' );
		server.kill();
	}
}

describe( 'the plugin launcher', () => {
	it( 'unpacks the CLI inside the plugin', async () => {
		const main = await start();

		expect( main ).toBe( path.join( pluginRoot, 'cli', 'main.mjs' ) );
		expect( fs.readdirSync( pluginRoot ).sort() ).toEqual( [
			'cli',
			'cli.tar.br',
			'mcp-snapshot.json',
			'scripts',
		] );
	} );

	it( 'unpacks the CLI in the data folder of an app that gives it one', async () => {
		// Created on first start: the app may only name it.
		const data = path.join( tmp, 'data', 'wp-studio' );
		// A read-only folder still accepts writes on Windows.
		if ( ! WINDOWS ) fs.chmodSync( pluginRoot, 0o555 );

		const main = await start( { PLUGIN_DATA: data } );

		expect( main ).toBe( path.join( data, `cli-${ VERSION }`, 'main.mjs' ) );
		expect( fs.readdirSync( data ) ).toEqual( [ `cli-${ VERSION }` ] );
		expect( fs.existsSync( path.join( pluginRoot, 'cli' ) ) ).toBe( false );
	} );

	it( 'replaces the CLI an earlier plugin version left in the data folder', async () => {
		const data = path.join( tmp, 'data' );
		fs.mkdirSync( path.join( data, 'cli-1.0.0' ), { recursive: true } );
		fs.writeFileSync( path.join( data, 'cli-1.0.0', 'main.mjs' ), '' );
		fs.writeFileSync( path.join( data, 'notes.txt' ), '' );

		const main = await start( { PLUGIN_DATA: data } );

		expect( main ).toBe( path.join( data, `cli-${ VERSION }`, 'main.mjs' ) );
		expect( fs.readdirSync( data ).sort() ).toEqual( [ `cli-${ VERSION }`, 'notes.txt' ] );
	} );
} );
