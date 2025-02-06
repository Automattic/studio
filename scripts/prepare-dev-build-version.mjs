// Rewrites the version in package.json so it includes the `-devN` style suffix of dev builds,
// where N is the number of commits since the last tag.

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { getLatestTag, getCommitCount } from './lib/git-utils.mjs';

const __dirname = path.dirname( fileURLToPath( import.meta.url ) );

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
