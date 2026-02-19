// Fails (thus halting the build) if the git tag doesn't match the version in package.json.
// This safety measure is part of the release build process.

import packageJson from '../apps/studio/package.json' with { type: 'json' };

const tagTriggeringBuild = process.env.BUILDKITE_TAG;

if ( ! tagTriggeringBuild ) {
	// Are you trying to dev on the build scripts outside of CI?
	// You will need to define the BUILDKITE_TAG environment variable before
	// running this script. e.g.
	// BUILDKITE_TAG=v1.2.3 node ./scripts/confirm-tag-matches-version.mjs
	throw new Error( 'Build was not triggered by a new tag' );
}

if ( tagTriggeringBuild === packageJson.version ) {
	throw new Error( 'The git tag used to trigger a release build must start with "v"' );
}

if ( tagTriggeringBuild !== 'v' + packageJson.version ) {
	throw new Error(
		`Tag which triggered the build (${ tagTriggeringBuild }) does not match version in package.json (${ packageJson.version })`
	);
}

process.exit( 0 );
