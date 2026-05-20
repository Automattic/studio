import fs from 'fs';
import os from 'os';
import path from 'path';
import {
	MinimumNativePhpSupportedVersion,
	resolveNativePhpVersion,
	getConfiguredPhpBinaryVersion,
	getPhpBinaryDownloadInfo,
} from '@studio/common/lib/php-binary-metadata';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	ensurePhpBinaryAvailable,
	resolvePhpBinaryDownloadInfo,
} from 'cli/lib/dependency-management/php-binary';

let configDir: string;
let bundledPhpDir: string;

function getBinaryName(): string {
	return process.platform === 'win32' ? 'php.exe' : 'php';
}

function getConfiguredPhpBinaryDir(): string {
	return path.join( configDir, 'php-bin', getConfiguredPhpBinaryVersion( '8.4' )! );
}

function writeBundledPhpBinary(): void {
	const bundledDir = path.join( bundledPhpDir, getConfiguredPhpBinaryVersion( '8.4' )! );
	fs.mkdirSync( bundledDir, { recursive: true } );
	fs.writeFileSync( path.join( bundledDir, getBinaryName() ), 'bundled php' );
	fs.writeFileSync( path.join( bundledDir, 'runtime.json' ), '{"binary":"php"}' );
}

beforeEach( () => {
	configDir = fs.mkdtempSync( path.join( os.tmpdir(), 'studio-php-bin-' ) );
	bundledPhpDir = fs.mkdtempSync( path.join( os.tmpdir(), 'studio-bundled-php-bin-' ) );
	vi.stubEnv( 'DEV_CONFIG_DIR', configDir );
	vi.stubEnv( 'STUDIO_BUNDLED_PHP_BIN_ROOT', bundledPhpDir );
} );

afterEach( () => {
	vi.unstubAllEnvs();
	fs.rmSync( configDir, { recursive: true, force: true } );
	fs.rmSync( bundledPhpDir, { recursive: true, force: true } );
} );

describe( 'getPhpBinaryDownloadInfo', () => {
	it( 'uses checked-in CDN metadata for a matching URL and SHA', () => {
		expect( getPhpBinaryDownloadInfo( '8.4', 'darwin', 'arm64' ) ).toEqual(
			expect.objectContaining( {
				patchVersion: getConfiguredPhpBinaryVersion( '8.4' ),
				url: expect.stringContaining( '/downloads/wordpress-com-studio-php-cli/mac-silicon/' ),
				sha: expect.stringMatching( /^[a-f0-9]{64}$/ ),
			} )
		);
	} );

	it( 'uses the Windows x64 CDN binary on Windows ARM64', () => {
		expect( getPhpBinaryDownloadInfo( '8.4', 'win32', 'arm64' ) ).toEqual(
			expect.objectContaining( {
				patchVersion: getConfiguredPhpBinaryVersion( '8.4' ),
				url: expect.stringContaining( '/downloads/wordpress-com-studio-php-cli/windows-x64/' ),
				sha: expect.stringMatching( /^[a-f0-9]{64}$/ ),
			} )
		);
	} );

	it( 'returns the configured patch version for a PHP minor', () => {
		expect( getConfiguredPhpBinaryVersion( '8.4' ) ).toMatch( /^\d+\.\d+\.\d+$/ );
	} );

	it( 'returns undefined when metadata is missing for the platform', () => {
		expect( getPhpBinaryDownloadInfo( '8.4', 'aix', 'x64' ) ).toBeUndefined();
	} );

	it( 'coerces older supported PHP versions to the minimum native version', () => {
		expect( resolveNativePhpVersion( '8.0' ) ).toBe( MinimumNativePhpSupportedVersion );
	} );
} );

describe( 'resolvePhpBinaryDownloadInfo', () => {
	it( 'rejects with a user-facing unavailable message', async () => {
		await expect( resolvePhpBinaryDownloadInfo( '8.4', 'aix', 'x64' ) ).rejects.toThrow(
			'PHP 8.4 is not available for this platform yet.'
		);
	} );
} );

describe( 'ensurePhpBinaryAvailable', () => {
	it( 'installs the bundled PHP binary before downloading', async () => {
		writeBundledPhpBinary();

		await ensurePhpBinaryAvailable( '8.4' );

		const installedDir = getConfiguredPhpBinaryDir();
		const installedBinary = path.join( installedDir, getBinaryName() );
		expect( fs.readFileSync( installedBinary, 'utf8' ) ).toBe( 'bundled php' );
		expect( fs.existsSync( path.join( installedDir, 'php.ini' ) ) ).toBe( true );
		expect( fs.existsSync( path.join( installedDir, 'ca-bundle.crt' ) ) ).toBe( true );
	} );
} );
