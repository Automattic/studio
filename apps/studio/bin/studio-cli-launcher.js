/**
 * CLI Launcher for AppX (Microsoft Store) installations.
 *
 * This script is compiled into a standalone .exe via @yao-pkg/pkg and used as the
 * target for the AppExecutionAlias in the AppxManifest. When a user types `studio`
 * in their terminal, Windows activates this executable within the package context,
 * giving it full access to the bundled CLI binary.
 */
const { spawn } = require( 'child_process' );
const path = require( 'path' );
const fs = require( 'fs' );

const exeDir = path.dirname( process.execPath );
const cliBinary = path.join( exeDir, 'studio.exe' );

if ( ! fs.existsSync( cliBinary ) ) {
	process.stderr.write( 'Error: Studio CLI binary not found at: ' + cliBinary + '\n' );
	process.exit( 1 );
}

const child = spawn( cliBinary, process.argv.slice( 2 ), {
	stdio: 'inherit',
	windowsHide: false,
} );

child.on( 'exit', ( code ) => {
	process.exit( code ?? 1 );
} );

child.on( 'error', ( err ) => {
	process.stderr.write( 'Error launching CLI: ' + err.message + '\n' );
	process.exit( 1 );
} );
