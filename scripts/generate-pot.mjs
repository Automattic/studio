#!/usr/bin/env node

/**
 * Extracts the translatable strings into `i18n/bundle-strings.pot`, which GlotPress imports from trunk.
 *
 * `--check` leaves the file alone and fails when it is out of date, for CI.
 *
 * References name the file without its line number, so the file only changes when strings do.
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve( path.dirname( fileURLToPath( import.meta.url ) ), '..' );
const POT_FILE = path.join( ROOT, 'i18n', 'bundle-strings.pot' );
const SOURCES = '{apps/studio/src,apps/cli,apps/ui/src,packages/common,packages/blueprints}';

function extract() {
	const workDir = fs.mkdtempSync( path.join( os.tmpdir(), 'studio-pot-' ) );
	const output = path.join( workDir, 'bundle-strings.pot' );
	try {
		const cli = createRequire( import.meta.url ).resolve( '@automattic/wp-babel-makepot/cli.js' );
		const result = spawnSync(
			process.execPath,
			[
				cli,
				`${ ROOT }/${ SOURCES }/**/*.{js,jsx,ts,tsx}`,
				'--ignore',
				`${ ROOT }/apps/cli/node_modules/**/*,**/*.d.ts`,
				'--base',
				ROOT,
				'--dir',
				path.join( workDir, 'segments' ),
				'--output',
				output,
			],
			// `wp-babel-makepot` runs every file through `@babel/preset-env` and keeps only the AST.
			// Targeting the current Node turns off downlevel transforms that choke on syntax such as `await using`.
			{ encoding: 'utf8', env: { ...process.env, BROWSERSLIST: 'current node' } }
		);
		const log = `${ result.stdout }${ result.stderr }`;
		// makepot logs the files it fails to parse and still exits 0, silently dropping their strings.
		if ( result.status !== 0 || /BABEL_\w+_ERROR/.test( log ) ) {
			throw new Error( `wp-babel-makepot failed, so the strings would be incomplete:\n${ log }` );
		}
		return sortEntries( withoutLineNumbers( fs.readFileSync( output, 'utf8' ) ) );
	} finally {
		fs.rmSync( workDir, { recursive: true, force: true } );
	}
}

function withoutLineNumbers( pot ) {
	let references = new Set();
	return pot
		.split( '\n' )
		.map( ( line ) => ( line.startsWith( '#: ' ) ? line.replace( /:\d+$/, '' ) : line ) )
		.filter( ( line ) => {
			if ( line === '' ) {
				references = new Set();
			}
			if ( ! line.startsWith( '#: ' ) ) {
				return true;
			}
			if ( references.has( line ) ) {
				return false;
			}
			references.add( line );
			return true;
		} )
		.join( '\n' );
}

// Orders entries by context and string rather than by where they first appear, so moving code doesn't reorder them.
function sortEntries( pot ) {
	const [ warning, header, ...rest ] = pot.split( '\n\n' );
	const end = rest.pop();
	const key = ( entry ) =>
		entry
			.split( '\n' )
			.filter( ( line ) => ! line.startsWith( '#' ) )
			.join( '\n' );
	const entries = rest
		.map( ( entry ) => [ key( entry ), entry ] )
		.sort( ( [ a ], [ b ] ) => ( a < b ? -1 : a > b ? 1 : 0 ) )
		.map( ( [ , entry ] ) => entry );
	return [ warning, header, ...entries, end ].join( '\n\n' );
}

const pot = extract();
const relativePotFile = path.relative( ROOT, POT_FILE );

if ( process.argv.includes( '--check' ) ) {
	const current = fs.existsSync( POT_FILE ) ? fs.readFileSync( POT_FILE, 'utf8' ) : '';
	if ( current !== pot ) {
		console.error(
			`${ relativePotFile } is out of date. Run \`npm run i18n:pot\` and commit the result.`
		);
		process.exit( 1 );
	}
	console.log( `${ relativePotFile } is up to date.` );
} else {
	fs.mkdirSync( path.dirname( POT_FILE ), { recursive: true } );
	fs.writeFileSync( POT_FILE, pot );
	console.log( `Wrote ${ relativePotFile }.` );
}
