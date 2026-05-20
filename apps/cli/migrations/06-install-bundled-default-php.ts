import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_PHP_VERSION } from '@studio/common/constants';
import { getBundledPhpBinaryPath, getPhpBinaryPath } from 'cli/lib/dependency-management/paths';
import type { Migration } from '@studio/common/lib/migration';

function getBundledDefaultPhpDir(): string {
	return path.dirname( getBundledPhpBinaryPath( DEFAULT_PHP_VERSION ) );
}

function getDefaultPhpDestinationDir(): string {
	return path.dirname( getPhpBinaryPath( DEFAULT_PHP_VERSION ) );
}

function bundledDefaultPhpExists(): boolean {
	return fs.existsSync( getBundledPhpBinaryPath( DEFAULT_PHP_VERSION ) );
}

export const installBundledDefaultPhp: Migration = {
	needsToRun: async () => {
		return bundledDefaultPhpExists() && ! fs.existsSync( getDefaultPhpDestinationDir() );
	},
	run: async () => {
		if ( ! bundledDefaultPhpExists() || fs.existsSync( getDefaultPhpDestinationDir() ) ) {
			return;
		}

		const destinationDir = getDefaultPhpDestinationDir();
		fs.mkdirSync( path.dirname( destinationDir ), { recursive: true } );
		try {
			fs.cpSync( getBundledDefaultPhpDir(), destinationDir, {
				recursive: true,
				force: true,
			} );

			if ( process.platform !== 'win32' ) {
				fs.chmodSync( getPhpBinaryPath( DEFAULT_PHP_VERSION ), 0o755 );
			}
		} catch ( error ) {
			fs.rmSync( destinationDir, { recursive: true, force: true } );
			console.warn(
				`Warning: failed to install bundled PHP ${ DEFAULT_PHP_VERSION } binary: ${
					( error as Error ).message
				}`
			);
		}
	},
};
