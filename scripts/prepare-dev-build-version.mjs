// Rewrites the version in package.json so it includes the `-dev.abcd` style suffix of dev builds.

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import semver from 'semver';
import { getLatestTag, getCommitCount } from './lib/git-utils.mjs';

const __dirname = path.dirname( fileURLToPath( import.meta.url ) );

const latestTag = getLatestTag();
const commitCount = getCommitCount( latestTag );

if ( ! commitCount && commitCount !== 0 ) {
	// Are you trying to dev on the build scripts outside of CI?
	// You will need to define the GITHUB_SHA or BUILDKITE_COMMIT environment
	// variable before running build scripts. e.g.
	// GITHUB_SHA=abcdef1234567890 node ./scripts/prepare-dev-build-version.mjs
	throw new Error( 'Missing commit count' );
}

const packageJsonPath = path.resolve( __dirname, '../package.json' );
const packageJsonText = await fs.readFile( packageJsonPath, 'utf-8' );
const packageJson = JSON.parse( packageJsonText );

// Use version from latestTag (strip leading 'v' if present)
const tagVersion = latestTag.startsWith( 'v' ) ? latestTag.slice( 1 ) : latestTag;
const parsedVersion = semver.parse( tagVersion );
if ( ! parsedVersion ) {
	throw new Error( `Invalid version in latestTag: ${ latestTag }` );
}

// Create dev version using just the core version numbers (major.minor.patch)
const devVersion = `${ parsedVersion.major }.${ parsedVersion.minor }.${ parsedVersion.patch }-dev${ commitCount }`;

packageJson.version = devVersion;

await fs.writeFile( packageJsonPath, JSON.stringify( packageJson, null, '\t' ) + '\n' );
