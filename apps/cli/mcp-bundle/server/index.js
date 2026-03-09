#!/usr/bin/env node
'use strict';

/**
 * WordPress Studio MCP Bundle launcher
 *
 * Locates the Studio app's bundled CLI and re-executes it as an MCP server
 * using the Node.js runtime that Claude Desktop provides (this script's runtime).
 */

const { spawnSync } = require( 'child_process' );
const fs = require( 'fs' );
const path = require( 'path' );

function findStudioCli() {
	const candidates = [];

	// Dev build: check for a built CLI next to this bundle's directory.
	// Resolved relative to this file: mcp-bundle/server/index.js → apps/cli/dist/cli/main.js
	candidates.push( path.resolve( __dirname, '..', '..', 'dist', 'cli', 'main.js' ) );

	if ( process.platform === 'darwin' ) {
		candidates.push(
			'/Applications/Studio.app/Contents/Resources/cli/main.js',
			path.join(
				process.env.HOME || '',
				'Applications/Studio.app/Contents/Resources/cli/main.js'
			)
		);
	} else if ( process.platform === 'win32' ) {
		const programFiles = process.env[ 'ProgramFiles' ] || 'C:\\Program Files';
		const localAppData = process.env[ 'LOCALAPPDATA' ] || '';
		candidates.push(
			path.join( programFiles, 'Studio', 'resources', 'cli', 'main.js' ),
			path.join( localAppData, 'Programs', 'Studio', 'resources', 'cli', 'main.js' )
		);
	}

	for ( const candidate of candidates ) {
		if ( fs.existsSync( candidate ) ) {
			return candidate;
		}
	}

	return null;
}

const cliPath = findStudioCli();
if ( ! cliPath ) {
	process.stderr.write(
		'WordPress Studio is not installed.\n' +
			'Download and install it from: https://developer.wordpress.com/studio\n'
	);
	process.exit( 1 );
}

// Use the same Node.js runtime that is executing this script (provided by Claude Desktop).
// Start the MCP server, inheriting stdin/stdout/stderr for JSON-RPC transport.
const result = spawnSync( process.execPath, [ cliPath, 'mcp' ], {
	stdio: 'inherit',
	env: process.env,
} );

process.exit( result.status ?? 1 );
