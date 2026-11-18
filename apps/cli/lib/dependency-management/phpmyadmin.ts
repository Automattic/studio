import fs from 'fs';
import path from 'path';
import { pathExists } from '@studio/common/lib/fs-utils';
import { installFromZip } from './install-from-zip';
import {
	getBundledPhpMyAdminZipPath,
	getPhpMyAdminVersionsPath,
	readBundledManifest,
} from './paths';

// A site started by another Studio or CLI version keeps serving the copy it started with, so a
// copy is removed only once no site start has used it for this long.
const UNUSED_VERSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

const isInstalled = ( target: string ) => pathExists( path.join( target, 'index.php' ) );

/**
 * The folder under `server-files/phpmyadmin-versions` that sites serve the bundled phpMyAdmin
 * from, named after the zip's hash so a Studio update that changes the patched files gets a fresh
 * copy. Null in a build without the wp-files manifest.
 */
export function getPhpMyAdminPath(): string | null {
	const hash = readBundledManifest()?.phpMyAdminHash;
	return hash ? path.join( getPhpMyAdminVersionsPath(), hash ) : null;
}

/**
 * Unpacks the bundled phpMyAdmin into `getPhpMyAdminPath()` unless it's already there. Runs on
 * every site start, without holding it up: phpMyAdmin answers 404 for the second it takes to
 * unpack after an update.
 */
export async function installBundledPhpMyAdmin(): Promise< void > {
	const target = getPhpMyAdminPath();
	if ( ! target ) {
		throw new Error( 'The CLI bundle has no wp-files manifest' );
	}
	if ( ! ( await isInstalled( target ) ) ) {
		await installFromZip( getBundledPhpMyAdminZipPath(), 'phpmyadmin', target, isInstalled );
	}
	const now = new Date();
	await fs.promises.utimes( target, now, now );
	await removeUnusedVersions( path.dirname( target ) );
}

async function removeUnusedVersions( versionsPath: string ) {
	const entries = await fs.promises.readdir( versionsPath );
	for ( const entry of entries ) {
		const entryPath = path.join( versionsPath, entry );
		try {
			const { mtimeMs } = await fs.promises.stat( entryPath );
			if ( Date.now() - mtimeMs > UNUSED_VERSION_MAX_AGE_MS ) {
				await fs.promises.rm( entryPath, { recursive: true, force: true } );
			}
		} catch {
			// Removed by another process meanwhile, or in use on Windows: try again next start.
		}
	}
}
