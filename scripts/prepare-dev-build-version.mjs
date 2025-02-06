// Rewrites the version in package.json so it includes the `-devN` style suffix of dev builds,
// where N is the number of commits since the last tag.

import * as child_process from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname( fileURLToPath( import.meta.url ) );

// Get the most recent tag
const getLatestTag = () => {
	try {
		return child_process.execSync( 'git describe --tags --abbrev=0' ).toString().trim();
	} catch ( error ) {
		// If no tags exist, return empty string
		return '';
	}
};

// Get commit count since the last tag
const getCommitCount = ( latestTag ) => {
	try {
		if ( latestTag ) {
			return parseInt(
				child_process.execSync( `git rev-list ${ latestTag }..HEAD --count` ).toString().trim(),
				10
			);
		}
		// If no tags exist, count all commits
		return parseInt( child_process.execSync( 'git rev-list --count HEAD' ).toString().trim(), 10 );
	} catch ( error ) {
		throw new Error( 'Failed to get commit count: ' + error.message );
	}
};

const latestTag = getLatestTag();
const commitCount = getCommitCount( latestTag );

if ( commitCount === undefined ) {
	throw new Error( 'Failed to determine commit count' );
}

const packageJsonPath = path.resolve( __dirname, '../package.json' );
const packageJsonText = await fs.readFile( packageJsonPath, 'utf-8' );
const packageJson = JSON.parse( packageJsonText );

const devVersion = `${ packageJson.version.split( '-' )[ 0 ] }-dev${ commitCount }`;

packageJson.version = devVersion;

await fs.writeFile( packageJsonPath, JSON.stringify( packageJson, null, '\t' ) + '\n' );
