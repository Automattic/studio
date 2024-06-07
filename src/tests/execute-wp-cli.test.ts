/**
 * @jest-environment node
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import nock from 'nock';
import { executeWPCli } from '../../vendor/wp-now/src/execute-wp-cli';

describe( 'executeWPCli', () => {
	const tmpPath = fs.mkdtempSync( path.join( os.tmpdir(), 'studio-test-wp-cli-site' ) );
	beforeAll( async () => {
		nock.enableNetConnect( 'raw.githubusercontent.com' );
		// It sets mode index so we don't need to download the whole WordPress
		fs.writeFileSync( path.join( tmpPath, 'index.php' ), '' );
	} );
	afterAll( () => {
		nock.disableNetConnect();
		fs.rmdirSync( tmpPath, { recursive: true } );
	} );

	it( 'should execute wp-cli version command and return stdout and stderr', async () => {
		const args = [ '--version' ];

		const result = await executeWPCli( tmpPath, args );

		expect( result.stdout ).toMatch( /WP-CLI \d+\.\d+\.\d+/ );
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
} );
