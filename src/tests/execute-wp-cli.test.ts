/**
 * @jest-environment node
 */

import os from 'os';
import path from 'path';
import fs from 'fs-extra';
import { executeWPCli } from '../../vendor/wp-now/src/execute-wp-cli';
import getSqlitePath from '../../vendor/wp-now/src/get-sqlite-path';
import getWpNowPath from '../../vendor/wp-now/src/get-wp-now-path';
import { getWPCliVersionFromInstallation } from '../lib/wpcli-versions';

jest.unmock( 'fs-extra' );

describe( 'executeWPCli', () => {
	beforeAll( async () => {
		fs.ensureDirSync( path.join( getWpNowPath(), 'wp-content' ) );
		fs.ensureDirSync( getSqlitePath() );
		fs.writeFileSync( path.join( getSqlitePath(), 'db.copy' ), '<?php' );
	} );
	afterAll( () => {
		fs.rmSync( getWpNowPath(), { recursive: true } );
	} );

	it( 'should execute wp-cli version command and return stdout and stderr', async () => {
		const args = [ '--version' ];

		const result = await executeWPCli( getWpNowPath(), args );

		expect( result.stdout ).toMatch( /WP-CLI \d+\.\d+\.\d+/ ); // Example: WP-CLI 2.10.0
		expect( result.stderr ).toBe( '' );
	} );

	it( 'should return error if wp-cli command does not exist', async () => {
		const originalConsoleError = console.error;
		const originalConsoleWarn = console.warn;
		console.error = jest.fn();
		console.warn = jest.fn();
		const args = [ 'yoda' ];

		const result = await executeWPCli( getWpNowPath(), args );

		expect( result.stdout ).toBe( '' );
		expect( result.stderr ).toContain(
			"'yoda' is not a registered wp command. See 'wp help' for available commands."
		);

		console.error = originalConsoleError;
		console.warn = originalConsoleWarn;
	} );

	it( 'should return the correct version of WP-CLI', async () => {
		const result = await getWPCliVersionFromInstallation();
		expect( result ).toMatch( /v\d+\.\d+\.\d+/ ); // Example: v2.10.0
	} );
} );
