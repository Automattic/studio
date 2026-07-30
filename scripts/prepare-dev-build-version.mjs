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

// Build a dev version targeting the next minor release (major.(minor+1).0-devN) from a base
// version, so trunk builds sort above any stable or beta of that base. Strips a leading 'v'.
function toDevVersion( baseVersion, source ) {
	const parsed = semver.parse(
		baseVersion.startsWith( 'v' ) ? baseVersion.slice( 1 ) : baseVersion
	);
	if ( ! parsed ) {
		throw new Error( `Invalid version in ${ source }: ${ baseVersion }` );
	}
	return `${ parsed.major }.${ parsed.minor + 1 }.0-dev${ commitCount }`;
}

// Desktop app: based on the latest release tag.
packageJson.version = toDevVersion( latestTag, 'latestTag' );
const packageJsonPath = path.resolve( 'apps', 'studio', 'package.json' );
await fs.writeFile( packageJsonPath, JSON.stringify( packageJson, null, '\t' ) + '\n' );

// Standalone CLI: based on its OWN current version — the CLI and app aren't guaranteed to share a
// version line. Its baked `__STUDIO_CLI_VERSION__` drives the update channel (a `-devN` version →
// nightly); without this a nightly bundle reports the static base version, looks like production
// to the update endpoint, and never sees nightly updates.
const cliPackageJsonPath = path.resolve( 'apps', 'cli', 'package.json' );
const cliPackageJson = JSON.parse( await fs.readFile( cliPackageJsonPath, 'utf8' ) );
cliPackageJson.version = toDevVersion( cliPackageJson.version, 'apps/cli/package.json' );
await fs.writeFile( cliPackageJsonPath, JSON.stringify( cliPackageJson, null, '\t' ) + '\n' );
