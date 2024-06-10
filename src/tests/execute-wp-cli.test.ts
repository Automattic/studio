/**
 * @jest-environment node
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { executeWPCli } from '../../vendor/wp-now/src/execute-wp-cli';
import {
	getWPCliVersionFromInstallation,
	isWPCliInstallationOutdated,
} from '../lib/wpcli-versions';

describe( 'executeWPCli', () => {
	const tmpPath = fs.mkdtempSync( path.join( os.tmpdir(), 'studio-test-wp-cli-site' ) );
	beforeAll( async () => {
		// It sets mode index so we don't need to download the whole WordPress
		fs.writeFileSync( path.join( tmpPath, 'index.php' ), '' );
	} );
	afterAll( () => {
		fs.rmdirSync( tmpPath, { recursive: true } );
	} );

	it( 'should execute wp-cli version command and return stdout and stderr', async () => {
		const args = [ '--version' ];

		const result = await executeWPCli( tmpPath, args );

		expect( result.stdout ).toMatch( /WP-CLI \d+\.\d+\.\d+/ ); // Example: WP-CLI 2.10.0
		expect( result.stderr ).toBe( '' );
	} );

	it( 'should return error if wp-cli command does not exist', async () => {
		const args = [ 'yoda' ];

		const result = await executeWPCli( tmpPath, args );

		expect( result.stdout ).toBe( '' );
		expect( result.stderr ).toContain(
			"'yoda' is not a registered wp command. See 'wp help' for available commands."
		);
	} );

	it( 'should return the correct version of WP-CLI', async () => {
		const result = await getWPCliVersionFromInstallation();
		expect( result ).toMatch( /v\d+\.\d+\.\d+/ ); // Example: v2.10.0
	} );

	it( 'should have the latest wp-cli version installed', async () => {
		const isOutdated = await isWPCliInstallationOutdated();
		expect( isOutdated ).toBe( false );
	} );
} );
