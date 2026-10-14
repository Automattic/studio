// The plugin's MCP server: `studio mcp`, from the Studio CLI the plugin carries
// (`cli.tar.br`, unpacked inside the plugin on first start, so Codex removes it
// with this plugin version), or from an installed Studio CLI at least as recent,
// such as the desktop app's.
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
} from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { createBrotliDecompress } from 'node:zlib';

const WINDOWS = process.platform === 'win32';
const PLUGIN_ROOT = fileURLToPath( new URL( '..', import.meta.url ) );
const CLI_BUNDLE = path.join( PLUGIN_ROOT, 'cli.tar.br' );
const BUNDLED_CLI = path.join( PLUGIN_ROOT, 'cli' );
const BUNDLED_MAIN = path.join( BUNDLED_CLI, 'main.mjs' );
// A published plugin has the version of the Studio CLI it carries.
const { version: PLUGIN_VERSION } = JSON.parse(
	readFileSync( path.join( PLUGIN_ROOT, '.codex-plugin', 'plugin.json' ), 'utf8' )
);

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
	if ( ! existsSync( CLI_BUNDLE ) ) {
		throw new Error(
			'No Studio CLI: set STUDIO_CLI_BIN to a development build, or install Studio.'
		);
	}
	process.stderr.write( 'Unpacking the Studio CLI that comes with the plugin.\n' );
	const staging = `${ BUNDLED_CLI }.${ process.pid }`;
	rmSync( staging, { recursive: true, force: true } );
	mkdirSync( staging );
	try {
		const tar = spawn( 'tar', [ '-xf', '-', '-C', staging ], {
			stdio: [ 'pipe', 'ignore', 'pipe' ],
		} );
		readline
			.createInterface( { input: tar.stderr } )
			.on( 'line', ( line ) => process.stderr.write( `${ line }\n` ) );
		const [ , [ code ] ] = await Promise.all( [
			pipeline( createReadStream( CLI_BUNDLE ), createBrotliDecompress(), tar.stdin ),
			once( tar, 'close' ),
		] );
		if ( code !== 0 ) throw new Error( `tar exited with code ${ code }` );
		try {
			renameSync( path.join( staging, 'cli' ), BUNDLED_CLI );
		} catch ( error ) {
			// Another session unpacked it first.
			if ( ! existsSync( BUNDLED_MAIN ) ) throw error;
		}
	} finally {
		rmSync( staging, { recursive: true, force: true } );
	}
}

// Unpacking takes seconds, so the host waits for it and starts with every tool.
let studio = await findStudio();
if ( ! studio ) {
	if ( ! existsSync( BUNDLED_MAIN ) ) await unpack();
	studio = [ process.execPath, BUNDLED_MAIN ];
}
const [ command, ...args ] = studio;
const child = spawn( ...commandArgs( command, [ ...args, 'mcp' ], { stdio: 'inherit' } ) );
for ( const signal of [ 'SIGINT', 'SIGTERM' ] ) {
	process.on( signal, () => child.kill( signal ) );
}
child.on( 'exit', ( code ) => process.exit( code ?? 1 ) );
