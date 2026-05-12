import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getInstalledPhpBinaryPath, getPhpBinaryPath } from 'cli/lib/dependency-management/paths';

let configDir: string;

function writePhpBinary( version: string ): string {
	const binaryPath = path.join(
		configDir,
		'php-bin',
		version,
		process.platform === 'win32' ? 'php.exe' : 'php'
	);
	fs.mkdirSync( path.dirname( binaryPath ), { recursive: true } );
	fs.writeFileSync( binaryPath, '' );
	return binaryPath;
}

describe( 'getPhpBinaryPath', () => {
	beforeEach( () => {
		configDir = fs.mkdtempSync( path.join( os.tmpdir(), 'studio-php-bin-' ) );
		vi.stubEnv( 'DEV_CONFIG_DIR', configDir );
	} );

	afterEach( () => {
		vi.unstubAllEnvs();
		fs.rmSync( configDir, { recursive: true, force: true } );
	} );

	it( 'uses the latest installed patch directory for a PHP minor', () => {
		writePhpBinary( '8.4.20' );
		const latestBinary = writePhpBinary( '8.4.21' );

		expect( getInstalledPhpBinaryPath( '8.4' ) ).toBe( latestBinary );
		expect( getPhpBinaryPath( '8.4' ) ).toBe( latestBinary );
	} );

	it( 'uses an exact patch path when called with a PHP patch version', () => {
		expect( getPhpBinaryPath( '8.4.21' ) ).toBe(
			path.join( configDir, 'php-bin', '8.4.21', process.platform === 'win32' ? 'php.exe' : 'php' )
		);
	} );
} );
