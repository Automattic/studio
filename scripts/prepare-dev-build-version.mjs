// Rewrites the version in package.json so it includes the `-dev.abcd` style suffix of dev builds.

import * as child_process from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname( fileURLToPath( import.meta.url ) );

const currentCommit = child_process.execSync( 'git rev-parse --short HEAD' ).toString().trim();

if ( ! currentCommit ) {
	// Are you trying to dev on the build scripts outside of CI?
	// You will need to define the GITHUB_SHA or BUILDKITE_COMMIT environment
	// variable before running build scripts. e.g.
	// GITHUB_SHA=abcdef1234567890 node ./scripts/prepare-dev-build-version.mjs
	throw new Error( 'Missing commit hash' );
}

const packageJsonPath = path.resolve( __dirname, '../package.json' );
const packageJsonText = await fs.readFile( packageJsonPath, 'utf-8' );
const packageJson = JSON.parse( packageJsonText );

const devVersion = `${ packageJson.version.split( '-' )[ 0 ] }-dev.${ currentCommit }`;

packageJson.version = devVersion;

await fs.writeFile( packageJsonPath, JSON.stringify( packageJson, null, '\t' ) + '\n' );
