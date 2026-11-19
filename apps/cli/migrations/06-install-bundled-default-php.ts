import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_PHP_VERSION } from '@studio/common/constants';
import {
	getConfiguredPhpBinaryPackageId,
	resolveSupportedPhpVersion,
} from '@studio/common/lib/php-binary-metadata';
import * as tar from 'tar';
import { getPhpBinaryPath } from 'cli/lib/dependency-management/paths';
import type { Migration } from '@studio/common/lib/migration';

const PHP_BINARY_FILENAME = process.platform === 'win32' ? 'php.exe' : 'php';

function getBundledPhpBinaryRoot(): string {
	return (
		process.env.STUDIO_BUNDLED_PHP_BIN_ROOT ?? path.resolve( import.meta.dirname, '..', 'php-bin' )
	);
}

function getDefaultPhpPackageId(): string {
	const nativeVersion = resolveSupportedPhpVersion( DEFAULT_PHP_VERSION );
	return getConfiguredPhpBinaryPackageId( nativeVersion ) ?? nativeVersion;
}

function getBundledDefaultPhpArchivePath(): string {
	return path.join( getBundledPhpBinaryRoot(), `${ getDefaultPhpPackageId() }.tar.br` );
}

function getDefaultPhpDestinationDir(): string {
	return path.dirname( getPhpBinaryPath( DEFAULT_PHP_VERSION ) );
}

// Packaged Studio builds include the default PHP package in app resources, as a brotli-compressed
// tarball. Unpack it into the writable PHP cache so first native-PHP startup works offline.
// The Desktop app starts several CLI processes at once on first launch, so each
// unpacks into its own staging folder and renames it into place: the destination
// only ever appears complete, and a process that loses the race never removes it.
export const installBundledDefaultPhp: Migration = {
	needsToRun: async () => {
		return (
			fs.existsSync( getBundledDefaultPhpArchivePath() ) &&
			! fs.existsSync( getDefaultPhpDestinationDir() )
		);
	},
	run: async () => {
		const destinationDir = getDefaultPhpDestinationDir();
		fs.mkdirSync( path.dirname( destinationDir ), { recursive: true } );
		const stagingDir = fs.mkdtempSync( `${ destinationDir }.tmp-` );
		try {
			await tar.x( {
				file: getBundledDefaultPhpArchivePath(),
				cwd: stagingDir,
				brotli: true,
				strict: true,
			} );

			if ( process.platform !== 'win32' ) {
				fs.chmodSync( path.join( stagingDir, PHP_BINARY_FILENAME ), 0o755 );
			}

			fs.renameSync( stagingDir, destinationDir );
		} catch ( error ) {
			fs.rmSync( stagingDir, { recursive: true, force: true } );
			if ( ! fs.existsSync( destinationDir ) ) {
				console.warn(
					`Warning: failed to install bundled PHP ${ DEFAULT_PHP_VERSION } package: ${
						( error as Error ).message
					}`
				);
			}
		}
	},
};
