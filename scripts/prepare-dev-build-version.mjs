// Rewrites the version in package.json so it includes the `-dev.abcd` style suffix of dev builds.

import fs from 'fs/promises';
import path from 'path';
import semver from 'semver';
import packageJson from '../apps/studio/package.json' with { type: 'json' };
import { getCommitCount, getLatestTag } from './lib/git-utils.mjs';

const latestTag = getLatestTag();
const commitCount = getCommitCount( latestTag );

if ( ! commitCount && commitCount !== 0 ) {
	// Are you trying to dev on the build scripts outside of CI?
	// You will need to define the GITHUB_SHA or BUILDKITE_COMMIT environment
	// variable before running build scripts. e.g.
	// GITHUB_SHA=abcdef1234567890 node ./scripts/prepare-dev-build-version.mjs
	throw new Error( 'Missing commit count' );
}

// Use version from latestTag (strip leading 'v' if present)
const tagVersion = latestTag.startsWith( 'v' ) ? latestTag.slice( 1 ) : latestTag;
const parsedVersion = semver.parse( tagVersion );
if ( ! parsedVersion ) {
	throw new Error( `Invalid version in latestTag: ${ latestTag }` );
}

// Create dev version targeting the next minor release (major.minor+1.0-devN),
// so trunk builds sort above any stable or beta of the last release.
const devVersion = `${ parsedVersion.major }.${ parsedVersion.minor + 1 }.0-dev${ commitCount }`;

packageJson.version = devVersion;

const packageJsonPath = path.resolve( 'apps', 'studio', 'package.json' );
await fs.writeFile( packageJsonPath, JSON.stringify( packageJson, null, '\t' ) + '\n' );

// Also stamp the standalone Studio CLI so its baked `__STUDIO_CLI_VERSION__` matches this dev
// build. The CLI's version drives its update channel (a `-devN` version → nightly), so without
// this a nightly bundle reports the static base version, looks like production to the update
// endpoint, and never sees nightly updates.
const cliPackageJsonPath = path.resolve( 'apps', 'cli', 'package.json' );
const cliPackageJson = JSON.parse( await fs.readFile( cliPackageJsonPath, 'utf8' ) );
cliPackageJson.version = devVersion;
await fs.writeFile( cliPackageJsonPath, JSON.stringify( cliPackageJson, null, '\t' ) + '\n' );
