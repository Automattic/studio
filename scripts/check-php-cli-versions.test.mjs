import assert from 'node:assert/strict';
import { test } from 'vitest';
import {
	comparePatchVersions,
	latestPatchVersion,
	phpVersionExistsOnCdn,
} from './check-php-cli-versions.mjs';

test( 'comparePatchVersions compares each numeric version component', () => {
	assert.ok( comparePatchVersions( '8.4.10', '8.4.9' ) > 0 );
	assert.ok( comparePatchVersions( '8.4.9', '8.4.10' ) < 0 );
	assert.equal( comparePatchVersions( '8.4.10', '8.4.10' ), 0 );
} );

test( 'latestPatchVersion returns the latest stable patch for the requested minor', () => {
	const refs = [
		{ ref: 'refs/tags/php-8.4.9' },
		{ ref: 'refs/tags/php-8.4.10RC1' },
		{ ref: 'refs/tags/php-8.4.10' },
		{ ref: 'refs/tags/php-8.5.1' },
	];

	assert.equal( latestPatchVersion( refs, '8.4' ), '8.4.10' );
} );

test( 'latestPatchVersion returns undefined when no stable patch matches', () => {
	assert.equal( latestPatchVersion( [ { ref: 'refs/tags/php-8.4.10RC1' } ], '8.4' ), undefined );
} );

test( 'phpVersionExistsOnCdn checks every artifact target', async () => {
	const requests = [];
	const exists = await phpVersionExistsOnCdn( '8.5.7', 'studio-1', async ( url, options ) => {
		requests.push( { url, options } );
		return { status: 302, statusText: 'Found' };
	} );

	assert.equal( exists, true );
	assert.equal( requests.length, 5 );
	assert.ok(
		requests.every( ( { options } ) => options.method === 'HEAD' && options.redirect === 'manual' )
	);
	assert.ok( requests.every( ( { url } ) => url.endsWith( '/8.5.7-studio-1/full-install' ) ) );
} );

test( 'phpVersionExistsOnCdn returns false when an artifact is missing', async () => {
	const exists = await phpVersionExistsOnCdn( '8.5.8', 'studio-1', async ( url ) => ( {
		status: url.includes( 'windows-x64' ) ? 404 : 302,
		statusText: '',
	} ) );

	assert.equal( exists, false );
} );

test( 'phpVersionExistsOnCdn rejects unexpected CDN responses', async () => {
	await assert.rejects(
		() =>
			phpVersionExistsOnCdn( '8.5.8', 'studio-1', async () => ( {
				status: 500,
				statusText: 'Server Error',
			} ) ),
		/Apps CDN check failed/
	);
} );
