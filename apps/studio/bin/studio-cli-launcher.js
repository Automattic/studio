/**
 * CLI Launcher for AppX (Microsoft Store) installations.
 *
 * This script is compiled into a standalone .exe via @yao-pkg/pkg and used as the
 * target for the AppExecutionAlias in the AppxManifest. When a user types `studio`
 * in their terminal, Windows activates this executable within the package context,
 * giving it full access to the bundled Electron runtime and CLI scripts.
 *
 * Studio used to ship its own `node.exe` next to this launcher. It now runs the
 * Electron `Studio.exe` with ELECTRON_RUN_AS_NODE=1, which makes it act as a
 * regular Node.js process.
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
// <root>/resources/bin/studio-cli.exe   <- this file
// <root>/resources/cli/main.mjs         <- CLI entry point
// <root>/Studio.exe                     <- Electron binary (acts as Node via ELECTRON_RUN_AS_NODE)
const studioExe = path.join( exeDir, '..', '..', 'Studio.exe' );
const cliScript = path.join( exeDir, '..', 'cli', 'main.mjs' );

if ( ! fs.existsSync( studioExe ) ) {
	process.stderr.write( 'Error: Studio runtime not found at: ' + studioExe + '\n' );
	process.exit( 1 );
}
if ( ! fs.existsSync( cliScript ) ) {
	process.stderr.write( 'Error: CLI script not found at: ' + cliScript + '\n' );
	process.exit( 1 );
}

// Prevent Node from printing warnings about NODE_OPTIONS being ignored
delete process.env.NODE_OPTIONS;

// Spawn the Electron binary as Node and pass through all arguments
const child = spawn( studioExe, [ cliScript, ...process.argv.slice( 2 ) ], {
	stdio: 'inherit',
	windowsHide: false,
	env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
} );

child.on( 'exit', ( code ) => {
	process.exit( code ?? 1 );
} );

child.on( 'error', ( err ) => {
	process.stderr.write( 'Error launching CLI: ' + err.message + '\n' );
	process.exit( 1 );
} );
