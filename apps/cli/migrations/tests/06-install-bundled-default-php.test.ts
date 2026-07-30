import fs from 'fs';
import os from 'os';
import path from 'path';
import { DEFAULT_PHP_VERSION } from '@studio/common/constants';
import {
	getConfiguredPhpBinaryPackageId,
	resolveNativePhpVersion,
} from '@studio/common/lib/php-binary-metadata';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installBundledDefaultPhp } from 'cli/migrations/06-install-bundled-default-php';

let configDir: string;
let bundledPhpDir: string;

function getBinaryName(): string {
	return process.platform === 'win32' ? 'php.exe' : 'php';
}

function getDefaultPhpPackageId(): string {
	return getConfiguredPhpBinaryPackageId( resolveNativePhpVersion( DEFAULT_PHP_VERSION ) )!;
}

function getBundledDefaultPhpDir(): string {
	return path.join( bundledPhpDir, getDefaultPhpPackageId() );
}

function getDefaultPhpDestinationDir(): string {
	return path.join( configDir, 'php-bin', getDefaultPhpPackageId() );
}

function writeBundledDefaultPhp(): void {
	const bundledDir = getBundledDefaultPhpDir();
	fs.mkdirSync( bundledDir, { recursive: true } );
	fs.writeFileSync( path.join( bundledDir, getBinaryName() ), 'bundled php' );
	fs.writeFileSync( path.join( bundledDir, 'runtime.json' ), '{"binary":"php"}' );
}

describe( 'installBundledDefaultPhp', () => {
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

	it( 'does not run when bundled PHP is unavailable', async () => {
		await expect( installBundledDefaultPhp.needsToRun() ).resolves.toBe( false );
	} );

	it( 'copies the bundled default PHP folder when the destination patch folder is missing', async () => {
		writeBundledDefaultPhp();

		await expect( installBundledDefaultPhp.needsToRun() ).resolves.toBe( true );
		await installBundledDefaultPhp.run();

		expect(
			fs.readFileSync( path.join( getDefaultPhpDestinationDir(), getBinaryName() ), 'utf8' )
		).toBe( 'bundled php' );
		expect(
			fs.readFileSync( path.join( getDefaultPhpDestinationDir(), 'runtime.json' ), 'utf8' )
		).toBe( '{"binary":"php"}' );
	} );

	it( 'does not replace an existing destination patch folder', async () => {
		writeBundledDefaultPhp();
		fs.mkdirSync( getDefaultPhpDestinationDir(), { recursive: true } );
		fs.writeFileSync( path.join( getDefaultPhpDestinationDir(), getBinaryName() ), 'existing php' );

		await expect( installBundledDefaultPhp.needsToRun() ).resolves.toBe( false );

		expect(
			fs.readFileSync( path.join( getDefaultPhpDestinationDir(), getBinaryName() ), 'utf8' )
		).toBe( 'existing php' );
	} );
} );
