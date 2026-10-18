// The plugin's MCP server: `studio mcp`, from the Studio CLI the plugin carries
// (`cli.tar.br`, unpacked inside the plugin on first start, so the agent app
// removes it with this plugin version), or from an installed Studio CLI at
// least as recent, such as the desktop app's.
//
// stdout carries the MCP messages: anything else must go to stderr.
import { execFile, spawn } from 'node:child_process';
import { once } from 'node:events';
import {
	accessSync,
	constants,
	createReadStream,
	existsSync,
	mkdirSync,
	readFileSync,
	realpathSync,
	renameSync,
	rmSync,
	statSync,
	writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { pipeline } from 'node:stream/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { createBrotliDecompress } from 'node:zlib';

const WINDOWS = process.platform === 'win32';
const PLUGIN_ROOT = fileURLToPath( new URL( '..', import.meta.url ) );
const CLI_BUNDLE = path.join( PLUGIN_ROOT, 'cli.tar.br' );
const BUNDLED_CLI = path.join( PLUGIN_ROOT, 'cli' );
const BUNDLED_MAIN = path.join( BUNDLED_CLI, 'main.mjs' );
const UNPACK_LOCK = `${ BUNDLED_CLI }.lock`;
// Only the holder of UNPACK_LOCK unpacks, so it can reuse one staging folder:
// whatever a stopped holder left there is cleared by the next.
const UNPACK_STAGING = `${ BUNDLED_CLI }.unpacking`;
// What `studio mcp` answers Codex's handshake and tool list with, recorded by the plugin build.
const SNAPSHOT = path.join( PLUGIN_ROOT, 'mcp-snapshot.json' );
// A published plugin has the version of the Studio CLI it carries.
const { version: PLUGIN_VERSION } = JSON.parse(
	readFileSync( path.join( PLUGIN_ROOT, '.codex-plugin', 'plugin.json' ), 'utf8' )
);

// Processes to stop with this one: tar while unpacking, then `studio mcp`.
const running = new Set();
for ( const signal of [ 'SIGINT', 'SIGTERM' ] ) {
	process.on( signal, () => {
		running.forEach( ( subprocess ) => subprocess.kill( signal ) );
		process.exit( 1 );
	} );
}

// Studio's usage events tell plugin sessions apart by STUDIO_PLUGIN_ID (from the
// MCP config) and this version.
process.env.STUDIO_PLUGIN_VERSION ??= PLUGIN_VERSION;

const isExecutable = ( file ) => {
	try {
		accessSync( file, constants.X_OK );
		// Windows can't stat an app execution alias, like the desktop app's `studio.exe`.
		return WINDOWS || statSync( file ).isFile();
	} catch {
		return false;
	}
};
const realpath = ( file ) => {
	try {
		return realpathSync( file );
	} catch {
		return file;
	}
};

// Windows runs a batch file (a `studio.cmd`) only through cmd.exe, as one command line.
const commandArgs = ( command, args, options ) =>
	/\.(bat|cmd)$/i.test( command )
		? [ [ `"${ command }"`, ...args ].join( ' ' ), [], { ...options, shell: true } ]
		: [ command, args, options ];

const cliVersion = ( command ) =>
	new Promise( ( resolve ) => {
		execFile( ...commandArgs( command, [ '--version' ], { timeout: 60_000 } ), ( error, stdout ) =>
			resolve( error ? null : stdout.match( /\d+\.\d+\.\d+/ )?.[ 0 ] ?? null )
		);
	} );

// Pre-releases count as their version: a 1.24.0 beta has what 1.24.0 has.
const isAtLeast = ( version, minimum ) => {
	const parts = version.split( '.' ).map( Number );
	const minimumParts = minimum.split( '.' ).map( Number );
	const differs = minimumParts.findIndex( ( part, i ) => parts[ i ] !== part );
	return differs === -1 || parts[ differs ] > minimumParts[ differs ];
};

// A development build (STUDIO_CLI_BIN), then the first of the `studio` command
// and the known install locations at least as recent as the plugin, so the
// bundled CLI never touches config a newer Studio wrote.
async function findStudio() {
	if ( process.env.STUDIO_CLI_BIN ) {
		return [ process.execPath, process.env.STUDIO_CLI_BIN ];
	}
	const names = WINDOWS ? [ 'studio.exe', 'studio.cmd', 'studio.bat' ] : [ 'studio' ];
	const candidates = [
		...( process.env.PATH ?? '' )
			.split( path.delimiter )
			.flatMap( ( dir ) => names.map( ( name ) => path.join( dir, name ) ) ),
		path.join( homedir(), '.local', 'bin', 'studio' ),
		path.join( homedir(), '.studio', 'bin', 'studio' ),
		'/Applications/Studio.app/Contents/Resources/bin/studio-cli.sh',
		'/usr/lib/studio/resources/bin/studio-cli.sh',
	];
	const checked = new Set();
	for ( const command of candidates.filter( isExecutable ) ) {
		const target = realpath( command );
		if ( checked.has( target ) ) continue;
		checked.add( target );
		const version = await cliVersion( command );
		if ( version && isAtLeast( version, PLUGIN_VERSION ) ) {
			return [ command ];
		}
	}
	return null;
}

// Unpacks the bundled CLI aside and moves it in place once complete, so a
// session that starts meanwhile never runs a partial CLI.
async function unpack() {
	process.stderr.write( 'Unpacking the Studio CLI that comes with the plugin.\n' );
	const staging = UNPACK_STAGING;
	rmSync( staging, { recursive: true, force: true } );
	mkdirSync( staging );
	try {
		// Windows' own tar: Git Bash's GNU tar can come first on PATH.
		const tar = spawn(
			WINDOWS ? path.join( process.env.SystemRoot, 'System32', 'tar.exe' ) : 'tar',
			[ '-xf', '-', '-C', staging ],
			{
				stdio: [ 'pipe', 'ignore', 'pipe' ],
			}
		);
		running.add( tar );
		readline
			.createInterface( { input: tar.stderr } )
			.on( 'line', ( line ) => process.stderr.write( `${ line }\n` ) );
		const [ , [ code ] ] = await Promise.all( [
			pipeline( createReadStream( CLI_BUNDLE ), createBrotliDecompress(), tar.stdin ),
			once( tar, 'close' ),
		] );
		running.delete( tar );
		if ( code !== 0 ) throw new Error( `tar exited with code ${ code }` );
		renameSync( path.join( staging, 'cli' ), BUNDLED_CLI );
	} finally {
		rmSync( staging, { recursive: true, force: true } );
	}
}

const isAlive = ( pid ) => {
	try {
		process.kill( pid, 0 );
		return true;
	} catch ( error ) {
		return error.code === 'EPERM';
	}
};

// Codex starts several servers at once: the first to take the lock unpacks,
// the others wait for it. A lock left by a process that died is taken over.
async function unpackOnce() {
	while ( ! existsSync( BUNDLED_MAIN ) ) {
		try {
			writeFileSync( UNPACK_LOCK, String( process.pid ), { flag: 'wx' } );
		} catch {
			let holder = 0;
			try {
				holder = Number( readFileSync( UNPACK_LOCK, 'utf8' ) );
			} catch {
				// Released meanwhile.
			}
			if ( holder > 0 && ! isAlive( holder ) ) {
				rmSync( UNPACK_LOCK, { force: true } );
			} else {
				await sleep( 1000 );
			}
			continue;
		}
		try {
			await unpack();
		} finally {
			rmSync( UNPACK_LOCK, { force: true } );
		}
	}
}

// Codex gives a server about ten seconds to answer its handshake and list its
// tools, and unpacking can take longer, Windows especially. Meanwhile, this
// answers them from the snapshot, holds every other message, then hands the
// session over to the bundled `studio mcp`. The tools depend on the client, so
// a client other than Codex is told to list them again.
async function standIn() {
	const recorded = readFileSync( SNAPSHOT, 'utf8' );
	// Some tool descriptions name folders in the home the snapshot was recorded in.
	const inJson = ( text ) => JSON.stringify( text ).slice( 1, -1 );
	const snapshot = JSON.parse(
		recorded.split( inJson( JSON.parse( recorded ).home ) ).join( inJson( homedir() ) )
	);
	const write = ( stream, message ) => stream.write( JSON.stringify( message ) + '\n' );
	const held = [];
	let initialize = null;
	let child = null;
	const host = readline.createInterface( { input: process.stdin } );
	host.on( 'line', ( line ) => {
		if ( child ) {
			child.stdin.write( line + '\n' );
			return;
		}
		const message = JSON.parse( line );
		if ( message.method === 'initialize' ) {
			initialize = message;
			const { protocolVersion } = message.params;
			const { capabilities } = snapshot.initialize;
			write( process.stdout, {
				jsonrpc: '2.0',
				id: message.id,
				result: {
					...snapshot.initialize,
					protocolVersion,
					capabilities: { ...capabilities, tools: { ...capabilities.tools, listChanged: true } },
				},
			} );
		} else if ( message.method === 'tools/list' || message.method === 'resources/list' ) {
			const result = message.method === 'tools/list' ? snapshot.tools : snapshot.resources;
			write( process.stdout, { jsonrpc: '2.0', id: message.id, result } );
		} else if ( message.method !== 'notifications/initialized' ) {
			held.push( line );
		}
	} );
	host.on( 'close', () => ( child ? child.stdin.end() : process.exit( 0 ) ) );

	await unpackOnce();
	child = spawn( process.execPath, [ BUNDLED_MAIN, 'mcp' ], {
		stdio: [ 'pipe', 'pipe', 'inherit' ],
	} );
	// The answers to this process's own requests, which the host never sees.
	const answers = new Map();
	readline.createInterface( { input: child.stdout } ).on( 'line', ( line ) => {
		const { id, result } = JSON.parse( line );
		if ( answers.has( id ) ) {
			answers.get( id )( result );
		} else {
			process.stdout.write( line + '\n' );
		}
	} );
	const ask = ( message ) =>
		new Promise( ( resolve ) => {
			answers.set( message.id, resolve );
			write( child.stdin, message );
		} );
	if ( initialize ) {
		await ask( { ...initialize, id: 'stand-in' } );
		write( child.stdin, { jsonrpc: '2.0', method: 'notifications/initialized' } );
		const { tools } = await ask( { jsonrpc: '2.0', id: 'stand-in-tools', method: 'tools/list' } );
		if ( JSON.stringify( tools ) !== JSON.stringify( snapshot.tools.tools ) ) {
			write( process.stdout, { jsonrpc: '2.0', method: 'notifications/tools/list_changed' } );
		}
	}
	held.splice( 0 ).forEach( ( line ) => child.stdin.write( line + '\n' ) );
	return child;
}

let child;
const studio = await findStudio();
if ( studio ) {
	const [ command, ...args ] = studio;
	child = spawn( ...commandArgs( command, [ ...args, 'mcp' ], { stdio: 'inherit' } ) );
} else if ( existsSync( BUNDLED_MAIN ) ) {
	child = spawn( process.execPath, [ BUNDLED_MAIN, 'mcp' ], { stdio: 'inherit' } );
} else if ( existsSync( CLI_BUNDLE ) ) {
	child = await standIn();
} else {
	throw new Error( 'No Studio CLI: set STUDIO_CLI_BIN to a development build, or install Studio.' );
}
running.add( child );
child.on( 'exit', ( code ) => process.exit( code ?? 1 ) );
