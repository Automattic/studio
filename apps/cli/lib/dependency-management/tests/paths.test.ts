import fs from 'fs';
import os from 'os';
import path from 'path';
import { getConfiguredPhpBinaryPackageId } from '@studio/common/lib/php-binary-metadata';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getPhpBinaryPath } from 'cli/lib/dependency-management/paths';

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

	it( 'uses the configured package directory for a PHP minor', () => {
		expect( getPhpBinaryPath( '8.4' ) ).toBe(
			path.join(
				configDir,
				'php-bin',
				getConfiguredPhpBinaryPackageId( '8.4' )!,
				process.platform === 'win32' ? 'php.exe' : 'php'
			)
		);
	} );

	it( 'does not let existing local patch folders override metadata', () => {
		const configuredVersion = getConfiguredPhpBinaryPackageId( '8.4' )!;
		const localBinary = writePhpBinary( configuredVersion === '8.4.20' ? '8.4.21' : '8.4.20' );

		expect( getPhpBinaryPath( '8.4' ) ).not.toBe( localBinary );
		expect( getPhpBinaryPath( '8.4' ) ).toBe(
			path.join(
				configDir,
				'php-bin',
				configuredVersion,
				process.platform === 'win32' ? 'php.exe' : 'php'
			)
		);
	} );

	it( 'uses an exact patch path when called with a PHP patch version', () => {
		expect( getPhpBinaryPath( '8.4.21' ) ).toBe(
			path.join( configDir, 'php-bin', '8.4.21', process.platform === 'win32' ? 'php.exe' : 'php' )
		);
	} );

	it( 'uses an exact package path when called with a Studio package ID', () => {
		expect( getPhpBinaryPath( '8.4.21-1.0.0' ) ).toBe(
			path.join(
				configDir,
				'php-bin',
				'8.4.21-1.0.0',
				process.platform === 'win32' ? 'php.exe' : 'php'
			)
		);
	} );
} );
