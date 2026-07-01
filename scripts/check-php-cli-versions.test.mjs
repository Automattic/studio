import assert from 'node:assert/strict';
import { test } from 'node:test';
import { comparePatchVersions, latestPatchVersion } from './check-php-cli-versions.mjs';

await test( 'comparePatchVersions compares each numeric version component', () => {
	assert.ok( comparePatchVersions( '8.4.10', '8.4.9' ) > 0 );
	assert.ok( comparePatchVersions( '8.4.9', '8.4.10' ) < 0 );
	assert.equal( comparePatchVersions( '8.4.10', '8.4.10' ), 0 );
} );

await test( 'latestPatchVersion returns the latest stable patch for the requested minor', () => {
	const refs = [
		{ ref: 'refs/tags/php-8.4.9' },
		{ ref: 'refs/tags/php-8.4.10RC1' },
		{ ref: 'refs/tags/php-8.4.10' },
		{ ref: 'refs/tags/php-8.5.1' },
	];

	assert.equal( latestPatchVersion( refs, '8.4' ), '8.4.10' );
} );

await test( 'latestPatchVersion returns undefined when no stable patch matches', () => {
	assert.equal( latestPatchVersion( [ { ref: 'refs/tags/php-8.4.10RC1' } ], '8.4' ), undefined );
} );
