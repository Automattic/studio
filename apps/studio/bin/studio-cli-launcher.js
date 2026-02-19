/**
 * CLI Launcher for AppX (Microsoft Store) installations.
 *
 * This script is compiled into a standalone .exe via @yao-pkg/pkg and used as the
 * target for the AppExecutionAlias in the AppxManifest. When a user types `studio`
 * in their terminal, Windows activates this executable within the package context,
 * giving it full access to the bundled node.exe and CLI scripts.
 *
 * This mirrors the behavior of studio-cli.bat but as an .exe (required by AppExecutionAlias).
 */
const { spawn } = require( 'child_process' );
const path = require( 'path' );
const fs = require( 'fs' );

// Get the directory where this executable is located.
// When activated via AppExecutionAlias, this resolves to the package's bin directory.
const exeDir = path.dirname( process.execPath );

// Paths relative to bin directory (mirrors studio-cli.bat layout):
// resources/bin/studio-cli.exe  <- this file
// resources/bin/node.exe        <- bundled Node
// resources/cli/main.js         <- CLI entry point
const nodeExe = path.join( exeDir, 'node.exe' );
const cliScript = path.join( exeDir, '..', 'cli', 'main.js' );

if ( ! fs.existsSync( nodeExe ) ) {
	process.stderr.write( 'Error: Node.js runtime not found at: ' + nodeExe + '\n' );
	process.exit( 1 );
}
if ( ! fs.existsSync( cliScript ) ) {
	process.stderr.write( 'Error: CLI script not found at: ' + cliScript + '\n' );
	process.exit( 1 );
}

// Prevent Node from printing warnings about NODE_OPTIONS being ignored
delete process.env.NODE_OPTIONS;

// Spawn node.exe with the CLI script and pass through all arguments
const child = spawn( nodeExe, [ cliScript, ...process.argv.slice( 2 ) ], {
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
