import fs from 'node:fs';
import path from 'node:path';
import {
	createBlueprintTempDir,
	removeBlueprintTempDir,
} from '@studio/common/lib/blueprint-bundle';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getBlueprintsPharPath, getPhpBinaryPath } from 'cli/lib/dependency-management/paths';
import { runBlueprint } from '../blueprints';
import { runPhpCommand } from '../php-process';
import type { NativePhpSupportedVersion } from '@studio/common/lib/php-binary-metadata';
import type { ServerConfig } from 'cli/lib/types/wordpress-server-ipc';

vi.mock( '../php-process', () => ( { runPhpCommand: vi.fn() } ) );
vi.mock( 'cli/lib/dependency-management/paths', () => ( {
	getBlueprintsPharPath: vi.fn(),
	getPhpBinaryPath: vi.fn(),
} ) );
vi.mock( '@studio/common/lib/blueprint-bundle', () => ( {
	createBlueprintTempDir: vi.fn(),
	removeBlueprintTempDir: vi.fn(),
} ) );

// blueprints.ts only touches fs.promises.{writeFile,unlink,rm} plus the SQLite
// symlink probe (existsSync). existsSync → false keeps the symlink path off.
vi.mock( 'node:fs', () => ( {
	default: {
		existsSync: vi.fn().mockReturnValue( false ),
		symlinkSync: vi.fn(),
		statSync: vi.fn(),
		promises: {
			writeFile: vi.fn().mockResolvedValue( undefined ),
			unlink: vi.fn().mockResolvedValue( undefined ),
			rm: vi.fn().mockResolvedValue( undefined ),
		},
	},
} ) );

const PHP_VERSION = '8.4' as NativePhpSupportedVersion;
const SITE_ID = 'site-123';
const SOURCE_DIR = path.join( path.sep, 'read-only' );
const FALLBACK_DIR = path.join( path.sep, 'tmp', 'studio-blueprint-bundle-mock' );
const BLUEPRINT_FILENAME = `studio-blueprint-${ SITE_ID }.json`;

function makeConfig(): ServerConfig {
	return { siteId: SITE_ID, sitePath: path.join( path.sep, 'sites', 'my-site' ), port: 8881 };
}

function makeBlueprint() {
	return { uri: path.join( SOURCE_DIR, 'install-theme.json' ), contents: { steps: [] } };
}

function pharArgs(): unknown[] {
	return vi.mocked( runPhpCommand ).mock.calls[ 0 ][ 0 ];
}

beforeEach( () => {
	vi.clearAllMocks();
	vi.mocked( getBlueprintsPharPath ).mockReturnValue(
		path.join( path.sep, 'bin', 'blueprints.phar' )
	);
	vi.mocked( getPhpBinaryPath ).mockReturnValue( path.join( path.sep, 'bin', 'php', 'php' ) );
	vi.mocked( runPhpCommand ).mockResolvedValue( { stdout: '' } );
	vi.mocked( createBlueprintTempDir ).mockResolvedValue( FALLBACK_DIR );
	vi.mocked( removeBlueprintTempDir ).mockResolvedValue( undefined );
	vi.mocked( fs.promises.writeFile ).mockResolvedValue( undefined );
} );

describe( 'runBlueprint (native)', () => {
	it( 'writes the temp blueprint next to the source when that directory is writable', async () => {
		const expectedPath = path.join( SOURCE_DIR, BLUEPRINT_FILENAME );

		await runBlueprint( makeConfig(), makeBlueprint(), PHP_VERSION, new AbortController().signal );

		expect( fs.promises.writeFile ).toHaveBeenCalledWith( expectedPath, expect.any( String ) );
		expect( pharArgs() ).toContain( expectedPath );
		// No fallback when the source directory accepts the write.
		expect( createBlueprintTempDir ).not.toHaveBeenCalled();
		expect( removeBlueprintTempDir ).not.toHaveBeenCalled();
	} );

	it( 'falls back to a writable temp dir when the source directory is read-only', async () => {
		const sourcePath = path.join( SOURCE_DIR, BLUEPRINT_FILENAME );
		const fallbackPath = path.join( FALLBACK_DIR, BLUEPRINT_FILENAME );
		vi.mocked( fs.promises.writeFile ).mockImplementation( async ( file ) => {
			if ( file === sourcePath ) {
				throw Object.assign( new Error( 'permission denied' ), { code: 'EACCES' } );
			}
		} );

		await runBlueprint( makeConfig(), makeBlueprint(), PHP_VERSION, new AbortController().signal );

		// Retried into the temp dir and ran blueprints.phar against that copy.
		expect( fs.promises.writeFile ).toHaveBeenCalledWith( fallbackPath, expect.any( String ) );
		expect( pharArgs() ).toContain( fallbackPath );
		expect( pharArgs() ).not.toContain( sourcePath );
		// The fallback dir is cleaned up afterwards.
		expect( removeBlueprintTempDir ).toHaveBeenCalledWith( FALLBACK_DIR );
	} );

	it( 'rethrows non-permission write errors without falling back', async () => {
		vi.mocked( fs.promises.writeFile ).mockRejectedValueOnce(
			Object.assign( new Error( 'no space left' ), { code: 'ENOSPC' } )
		);

		await expect(
			runBlueprint( makeConfig(), makeBlueprint(), PHP_VERSION, new AbortController().signal )
		).rejects.toThrow( 'no space left' );
		expect( createBlueprintTempDir ).not.toHaveBeenCalled();
		expect( runPhpCommand ).not.toHaveBeenCalled();
	} );
} );
