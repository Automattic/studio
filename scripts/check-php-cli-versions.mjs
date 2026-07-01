#!/usr/bin/env node

import fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import phpBinaryCdnMetadata from '../tools/common/lib/php-binary-cdn-metadata.mjs';

const PHP_UPSTREAM_REPOSITORY = 'php/php-src';

function parsePatchVersion( version ) {
	const match = version.match( /^(\d+)\.(\d+)\.(\d+)$/ );
	if ( ! match ) {
		throw new Error( `Expected a PHP patch version. Received: ${ version }` );
	}

	return match.slice( 1 ).map( Number );
}

export function comparePatchVersions( first, second ) {
	const firstParts = parsePatchVersion( first );
	const secondParts = parsePatchVersion( second );

	for ( let index = 0; index < firstParts.length; index += 1 ) {
		const difference = firstParts[ index ] - secondParts[ index ];
		if ( difference !== 0 ) {
			return difference;
		}
	}

	return 0;
}

export function latestPatchVersion( refs, phpMinor ) {
	const prefix = `refs/tags/php-${ phpMinor }.`;
	const versions = refs
		.map( ( ref ) => ref.ref )
		.filter( ( ref ) => ref.startsWith( prefix ) )
		.map( ( ref ) => ref.slice( 'refs/tags/php-'.length ) )
		.filter( ( version ) => /^\d+\.\d+\.\d+$/.test( version ) );

	return versions.sort( comparePatchVersions ).at( -1 );
}

async function githubRequest( path, { method = 'GET', body } = {} ) {
	const apiUrl = process.env.GITHUB_API_URL || 'https://api.github.com';
	const token = process.env.GH_TOKEN;
	if ( ! token ) {
		throw new Error( 'GH_TOKEN is required.' );
	}

	const response = await fetch( `${ apiUrl }${ path }`, {
		method,
		headers: {
			Accept: 'application/vnd.github+json',
			Authorization: `Bearer ${ token }`,
			'User-Agent': 'wordpress-studio-php-version-checker',
			'X-GitHub-Api-Version': '2022-11-28',
		},
		body: body ? JSON.stringify( body ) : undefined,
	} );

	if ( ! response.ok ) {
		throw new Error(
			`GitHub API request failed (${ response.status } ${
				response.statusText
			}): ${ await response.text() }`
		);
	}

	return response.status === 204 ? undefined : response.json();
}

async function findLatestPatchVersion( phpMinor ) {
	const refs = await githubRequest(
		`/repos/${ PHP_UPSTREAM_REPOSITORY }/git/matching-refs/tags/php-${ phpMinor }.?per_page=100`
	);
	const latestVersion = latestPatchVersion( refs, phpMinor );

	if ( ! latestVersion ) {
		throw new Error( `Could not find an upstream patch release for PHP ${ phpMinor }.` );
	}

	return latestVersion;
}

async function main() {
	const results = [];
	const phpVersionsToBuild = [];

	for ( const [ phpMinor, { version: currentVersion } ] of Object.entries(
		phpBinaryCdnMetadata.versions
	) ) {
		const latestVersion = await findLatestPatchVersion( phpMinor );
		let result = 'Up to date';

		if ( comparePatchVersions( latestVersion, currentVersion ) > 0 ) {
			phpVersionsToBuild.push( latestVersion );
			result = 'Build required';
		}

		results.push( { phpMinor, currentVersion, latestVersion, result } );
	}

	const phpVersionsOutput = JSON.stringify( phpVersionsToBuild );
	if ( process.env.GITHUB_OUTPUT ) {
		await fs.appendFile( process.env.GITHUB_OUTPUT, `php_versions=${ phpVersionsOutput }\n` );
	} else {
		console.log( `PHP versions requiring builds: ${ phpVersionsOutput }` );
	}

	const summary = [
		'### PHP CLI version check',
		'',
		'| PHP minor | Current binary | Latest upstream | Result |',
		'| --- | --- | --- | --- |',
		...results.map(
			( { phpMinor, currentVersion, latestVersion, result } ) =>
				`| ${ phpMinor } | ${ currentVersion } | ${ latestVersion } | ${ result } |`
		),
		'',
	].join( '\n' );

	if ( process.env.GITHUB_STEP_SUMMARY ) {
		await fs.appendFile( process.env.GITHUB_STEP_SUMMARY, summary );
	} else {
		console.log( summary );
	}
}

if ( process.argv[ 1 ] && import.meta.url === pathToFileURL( process.argv[ 1 ] ).href ) {
	main().catch( ( error ) => {
		console.error( error.message );
		process.exitCode = 1;
	} );
}
