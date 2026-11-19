import fs from 'fs';
import os from 'os';
import path from 'path';
import { DEFAULT_PHP_VERSION } from '@studio/common/constants';
import {
	getConfiguredPhpBinaryPackageId,
	resolveSupportedPhpVersion,
} from '@studio/common/lib/php-binary-metadata';
import * as tar from 'tar';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installBundledDefaultPhp } from 'cli/migrations/06-install-bundled-default-php';

let configDir: string;
let bundledPhpDir: string;

function getBinaryName(): string {
	return process.platform === 'win32' ? 'php.exe' : 'php';
}

function getDefaultPhpPackageId(): string {
	return getConfiguredPhpBinaryPackageId( resolveSupportedPhpVersion( DEFAULT_PHP_VERSION ) )!;
}

function getBundledDefaultPhpArchivePath(): string {
	return path.join( bundledPhpDir, `${ getDefaultPhpPackageId() }.tar.br` );
}

function getDefaultPhpDestinationDir(): string {
	return path.join( configDir, 'php-bin', getDefaultPhpPackageId() );
}

async function writeBundledDefaultPhp(): Promise< void > {
	const packageDir = fs.mkdtempSync( path.join( os.tmpdir(), 'studio-php-package-' ) );
	try {
		fs.mkdirSync( path.join( packageDir, 'ext' ) );
		fs.writeFileSync( path.join( packageDir, getBinaryName() ), 'bundled php', { mode: 0o644 } );
		fs.writeFileSync( path.join( packageDir, 'ext', 'xdebug.so' ), 'bundled xdebug' );
		fs.writeFileSync( path.join( packageDir, 'runtime.json' ), '{"binary":"php"}' );
		await tar.c(
			{ file: getBundledDefaultPhpArchivePath(), cwd: packageDir, brotli: true, portable: true },
			fs.readdirSync( packageDir )
		);
	} finally {
		fs.rmSync( packageDir, { recursive: true, force: true } );
	}
}

describe( 'installBundledDefaultPhp', () => {
	beforeEach( () => {
		configDir = fs.mkdtempSync( path.join( os.tmpdir(), 'studio-php-bin-' ) );
		bundledPhpDir = fs.mkdtempSync( path.join( os.tmpdir(), 'studio-bundled-php-bin-' ) );
		vi.stubEnv( 'DEV_CONFIG_DIR', configDir );
		vi.stubEnv( 'STUDIO_BUNDLED_PHP_BIN_ROOT', bundledPhpDir );
	} );

	afterEach( () => {
		vi.restoreAllMocks();
		vi.unstubAllEnvs();
		fs.rmSync( configDir, { recursive: true, force: true } );
		fs.rmSync( bundledPhpDir, { recursive: true, force: true } );
	} );

	it( 'does not run when bundled PHP is unavailable', async () => {
		await expect( installBundledDefaultPhp.needsToRun() ).resolves.toBe( false );
	} );

	it( 'unpacks the bundled default PHP archive when the destination patch folder is missing', async () => {
		await writeBundledDefaultPhp();

		await expect( installBundledDefaultPhp.needsToRun() ).resolves.toBe( true );
		await installBundledDefaultPhp.run();

		const destinationDir = getDefaultPhpDestinationDir();
		expect( fs.readFileSync( path.join( destinationDir, getBinaryName() ), 'utf8' ) ).toBe(
			'bundled php'
		);
		expect( fs.readFileSync( path.join( destinationDir, 'ext', 'xdebug.so' ), 'utf8' ) ).toBe(
			'bundled xdebug'
		);
		expect( fs.readFileSync( path.join( destinationDir, 'runtime.json' ), 'utf8' ) ).toBe(
			'{"binary":"php"}'
		);
		if ( process.platform !== 'win32' ) {
			expect( fs.statSync( path.join( destinationDir, getBinaryName() ) ).mode & 0o777 ).toBe(
				0o755
			);
		}
	} );

	it( 'leaves no folder when the bundled archive cannot be unpacked', async () => {
		await writeBundledDefaultPhp();
		const archive = fs.readFileSync( getBundledDefaultPhpArchivePath() );
		fs.writeFileSync(
			getBundledDefaultPhpArchivePath(),
			archive.subarray( 0, Math.floor( archive.length / 2 ) )
		);
		const warn = vi.spyOn( console, 'warn' ).mockImplementation( () => {} );

		await installBundledDefaultPhp.run();

		expect( fs.readdirSync( path.dirname( getDefaultPhpDestinationDir() ) ) ).toEqual( [] );
		expect( warn ).toHaveBeenCalledWith(
			expect.stringContaining( 'failed to install bundled PHP' )
		);
	} );

	it( 'does not replace an existing destination patch folder', async () => {
		await writeBundledDefaultPhp();
		fs.mkdirSync( getDefaultPhpDestinationDir(), { recursive: true } );
		fs.writeFileSync( path.join( getDefaultPhpDestinationDir(), getBinaryName() ), 'existing php' );

		await expect( installBundledDefaultPhp.needsToRun() ).resolves.toBe( false );

		expect(
			fs.readFileSync( path.join( getDefaultPhpDestinationDir(), getBinaryName() ), 'utf8' )
		).toBe( 'existing php' );
	} );

	it( 'keeps the folder another process installed first', async () => {
		await writeBundledDefaultPhp();
		await expect( installBundledDefaultPhp.needsToRun() ).resolves.toBe( true );
		fs.mkdirSync( getDefaultPhpDestinationDir(), { recursive: true } );
		fs.writeFileSync( path.join( getDefaultPhpDestinationDir(), getBinaryName() ), 'winner php' );

		await installBundledDefaultPhp.run();

		expect(
			fs.readFileSync( path.join( getDefaultPhpDestinationDir(), getBinaryName() ), 'utf8' )
		).toBe( 'winner php' );
		expect( fs.readdirSync( path.dirname( getDefaultPhpDestinationDir() ) ) ).toEqual( [
			getDefaultPhpPackageId(),
		] );
	} );
} );
