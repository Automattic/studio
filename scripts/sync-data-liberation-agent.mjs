#!/usr/bin/env node

/**
 * Replaces packages/data-liberation-agent with a verbatim copy of
 * https://github.com/Automattic/data-liberation-agent (defaults to its
 * default branch HEAD, or pass a ref/SHA as the first argument) and updates
 * .upstream-revision to match, so
 * scripts/check-data-liberation-agent-upstream.mjs stops failing.
 *
 * Usage:
 *   node scripts/sync-data-liberation-agent.mjs [ref]
 */

import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const UPSTREAM_GIT_URL = 'https://github.com/Automattic/data-liberation-agent.git';
const VENDORED_DIR = 'packages/data-liberation-agent';

const repoRoot = path.resolve( fileURLToPath( new URL( '.', import.meta.url ) ), '..' );

function run( command, args ) {
	execFileSync( command, args, { stdio: 'inherit' } );
}

/**
 * Replaces `destination` with a verbatim copy of `source`.
 *
 * verbatimSymlinks preserves upstream's relative links (CLAUDE.md -> AGENTS.md).
 * Without it cpSync rewrites them to absolute paths inside the throwaway clone
 * directory, vendoring symlinks that dangle on every other checkout.
 */
export function replaceVendoredTree( source, destination ) {
	rmSync( destination, { recursive: true, force: true } );
	cpSync( source, destination, { recursive: true, verbatimSymlinks: true } );
}

export async function main( { ref = process.argv[ 2 ] } = {} ) {
	const tmpDir = mkdtempSync( path.join( tmpdir(), 'data-liberation-agent-' ) );
	try {
		run( 'git', [ 'clone', '--quiet', UPSTREAM_GIT_URL, tmpDir ] );
		if ( ref ) {
			run( 'git', [ '-C', tmpDir, 'checkout', '--quiet', ref ] );
		}
		const revision = execFileSync( 'git', [ '-C', tmpDir, 'rev-parse', 'HEAD' ], {
			encoding: 'utf8',
		} ).trim();
		rmSync( path.join( tmpDir, '.git' ), { recursive: true, force: true } );

		const destination = path.join( repoRoot, VENDORED_DIR );
		replaceVendoredTree( tmpDir, destination );
		writeFileSync( path.join( destination, '.upstream-revision' ), `${ revision }\n` );

		console.log( `Synced ${ VENDORED_DIR } to Automattic/data-liberation-agent@${ revision }.` );
		console.log( '' );
		console.log( 'Review the diff, then commit it, e.g.:' );
		console.log( `  git add ${ VENDORED_DIR }` );
		console.log( `  git commit -m "sync(dla): refresh to ${ revision.slice( 0, 8 ) }"` );
	} finally {
		rmSync( tmpDir, { recursive: true, force: true } );
	}
}

if ( process.argv[ 1 ] && import.meta.url === pathToFileURL( process.argv[ 1 ] ).href ) {
	main().catch( ( error ) => {
		console.error( error.message );
		process.exitCode = 1;
	} );
}
