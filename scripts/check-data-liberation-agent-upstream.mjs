#!/usr/bin/env node

/**
 * packages/data-liberation-agent is a verbatim, unpatched copy of
 * https://github.com/Automattic/data-liberation-agent (studio-cli/site create
 * --from runs this vendored copy, not upstream). Nothing previously recorded
 * which upstream commit that copy came from — sync commits only named a SHA
 * in a free-text commit message — so nothing could ever notice upstream
 * moving on without a resync. This script is that missing check.
 *
 * .upstream-revision (next to this vendored package) records the upstream
 * commit the copy was last synced from. This script treats that pin as a
 * claim and verifies it against upstream's real HEAD:
 *
 *   - it compares the *committed dist/*.bundle.mjs bytes*, not the
 *     package.json version (only bumped on release, so it misses every
 *     unreleased merge - which is exactly the gap that let this branch drift
 *     three times in one day) and not a full source-tree diff (noisier, and
 *     unnecessary: Studio never patches this copy, see below).
 *   - upstream's own CI rebuilds and commits dist/ on every merged PR (not
 *     just releases) from a pinned lockfile, so the build is byte-
 *     deterministic: a fresh rebuild of a given commit reproduces that
 *     commit's committed dist/ exactly. That means upstream's own committed
 *     dist/*.bundle.mjs at a given revision *is* the rebuild output for that
 *     revision - we can compare against it directly over the network with no
 *     local build step, keeping this check cheap.
 *
 * This intentionally does not fail on a plain source-tree diff: Studio's copy
 * has no local patches (verified against .upstream-revision - a full
 * `diff -r` against upstream at that commit is empty), so if that ever
 * changes, a savvy maintainer should special-case it rather than have this
 * script fail on an intentional divergence it can't distinguish from drift.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const UPSTREAM_REPO = 'Automattic/data-liberation-agent';
const UPSTREAM_GIT_URL = `https://github.com/${ UPSTREAM_REPO }.git`;
const UPSTREAM_RAW_BASE = `https://raw.githubusercontent.com/${ UPSTREAM_REPO }`;
const VENDORED_DIR = 'packages/data-liberation-agent';
const REVISION_FILE_PATH = `${ VENDORED_DIR }/.upstream-revision`;

// The two artifacts the CLI actually loads at runtime (see that package's
// package.json `main`/`bin`/`exports`). Comparing these is both the
// strongest and the cheapest signal: no npm install, no esbuild, no browser.
export const DIST_FILES = [ 'dist/capture-engine.bundle.mjs', 'dist/mcp-server.bundle.mjs' ];

const repoRoot = path.resolve( fileURLToPath( new URL( '.', import.meta.url ) ), '..' );

export function readRecordedRevision( readFileImpl = readFileSync ) {
	return readFileImpl( path.join( repoRoot, REVISION_FILE_PATH ), 'utf8' ).trim();
}

export function parseLsRemoteHead( output ) {
	const sha = output.trim().split( /\s+/ )[ 0 ];
	if ( ! /^[0-9a-f]{40}$/.test( sha ?? '' ) ) {
		throw new Error( `Could not parse a commit SHA from git ls-remote output: ${ output }` );
	}
	return sha;
}

export function getLatestUpstreamRevision( execImpl = execFileSync ) {
	const output = execImpl( 'git', [ 'ls-remote', UPSTREAM_GIT_URL, 'HEAD' ], {
		encoding: 'utf8',
	} );
	return parseLsRemoteHead( output );
}

export async function fetchUpstreamFile( revision, relativePath, fetchImpl = fetch ) {
	const url = `${ UPSTREAM_RAW_BASE }/${ revision }/${ relativePath }`;
	const response = await fetchImpl( url );
	if ( ! response.ok ) {
		throw new Error( `Failed to fetch ${ url }: ${ response.status } ${ response.statusText }` );
	}
	return Buffer.from( await response.arrayBuffer() );
}

export function readVendoredFile( relativePath, readFileImpl = readFileSync ) {
	return readFileImpl( path.join( repoRoot, VENDORED_DIR, relativePath ) );
}

/**
 * Returns the subset of DIST_FILES whose vendored bytes differ from
 * upstream's committed bytes at `revision`.
 */
export async function findDivergentDistFiles(
	revision,
	{ fetchImpl = fetch, readFileImpl = readFileSync } = {}
) {
	const divergent = [];
	for ( const relativePath of DIST_FILES ) {
		const upstreamBytes = await fetchUpstreamFile( revision, relativePath, fetchImpl );
		const vendoredBytes = readVendoredFile( relativePath, readFileImpl );
		if ( ! upstreamBytes.equals( vendoredBytes ) ) {
			divergent.push( relativePath );
		}
	}
	return divergent;
}

export function formatFailure( { recordedRevision, latestRevision, divergentFiles } ) {
	return [
		`The vendored ${ VENDORED_DIR } copy does not match upstream ${ UPSTREAM_REPO }.`,
		'',
		`  Recorded revision (${ REVISION_FILE_PATH }): ${ recordedRevision }`,
		`  Latest upstream revision (HEAD):                 ${ latestRevision }`,
		`  https://github.com/${ UPSTREAM_REPO }/compare/${ recordedRevision }...${ latestRevision }`,
		'',
		`Stale committed bundle(s): ${ divergentFiles.join( ', ' ) }`,
		'',
		'To resync:',
		'',
		'  node scripts/sync-data-liberation-agent.mjs',
		'',
		`That replaces ${ VENDORED_DIR } with upstream ${ latestRevision } and updates`,
		".upstream-revision to match. Review the diff, then commit it (this branch's",
		`convention: "sync(dla): refresh to ${ latestRevision.slice( 0, 8 ) }").`,
	].join( '\n' );
}

export async function main() {
	const recordedRevision = readRecordedRevision();
	const latestRevision = getLatestUpstreamRevision();

	const divergentFiles = await findDivergentDistFiles( latestRevision );

	if ( divergentFiles.length > 0 ) {
		console.error( formatFailure( { recordedRevision, latestRevision, divergentFiles } ) );
		process.exitCode = 1;
		return;
	}

	if ( recordedRevision !== latestRevision ) {
		// Content is identical (upstream's newer commits didn't touch the
		// shipped bundles), so this isn't a functional regression - just log
		// it so the pin doesn't drift indefinitely.
		console.log(
			`Vendored ${ VENDORED_DIR } bundles match upstream HEAD (${ latestRevision }), ` +
				`though ${ REVISION_FILE_PATH } still names an older revision (${ recordedRevision }). ` +
				'Non-blocking: consider running scripts/sync-data-liberation-agent.mjs to update the pin.'
		);
		return;
	}

	console.log( `Vendored ${ VENDORED_DIR } matches upstream HEAD (${ latestRevision }).` );
}

if ( process.argv[ 1 ] && import.meta.url === pathToFileURL( process.argv[ 1 ] ).href ) {
	main().catch( ( error ) => {
		console.error( error.message );
		process.exitCode = 1;
	} );
}
