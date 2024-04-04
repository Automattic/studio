// Fails (thus halting the build) if the git tag doesn't match the version in package.json.
// This safety measure is part of the release build process.

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname( fileURLToPath( import.meta.url ) );

const tagTriggeringBuild = process.env.BUILDKITE_TAG;

if ( ! tagTriggeringBuild ) {
	// Are you trying to dev on the build scripts outside of CI?
	// You will need to define the BUILDKITE_TAG environment variable before
	// running this script. e.g.
	// BUILDKITE_TAG=v1.2.3 node ./scripts/confirm-tag-matches-version.mjs
	throw new Error( 'Build was not triggered by a new tag' );
}

const packageJsonPath = path.resolve( __dirname, '../package.json' );
const packageJsonText = await fs.readFile( packageJsonPath, 'utf-8' );
const { version: packageVersion } = JSON.parse( packageJsonText );

if ( tagTriggeringBuild === packageVersion ) {
	throw new Error( 'The git tag used to trigger a release build must start with "v"' );
}

if ( tagTriggeringBuild !== 'v' + packageVersion ) {
	throw new Error(
		`Tag which triggered the build (${ tagTriggeringBuild }) does not match version in package.json (${ packageVersion })`
	);
}

process.exit( 0 );
