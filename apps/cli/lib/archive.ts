import fs from 'fs';
import path from 'path';
import { createDeployIgnoreFilter } from '@studio/common/lib/deploy-ignore';
import { STUDIO_LOADER_MU_PLUGIN_FILENAME } from '@studio/common/lib/mu-plugins';
import { __ } from '@wordpress/i18n';
import { ZipArchive } from 'archiver';
import { glob } from 'glob';
import { LoggerError } from 'cli/logger';

const ZIP_COMPRESSION_LEVEL = 9;
const STUDIO_LOADER_ARCHIVE_PATH = `wp-content/mu-plugins/${ STUDIO_LOADER_MU_PLUGIN_FILENAME }`;

export async function archiveSiteContent(
	siteFolder: string,
	archivePath: string
): Promise< ZipArchive > {
	const deployIgnore = await createDeployIgnoreFilter( siteFolder );

	// `archiver.directory()` does not follow symlinks, so we enumerate the files
	// with glob ourselves to support symlinked plugins/themes. See
	// https://github.com/archiverjs/node-archiver/pull/810
	const wpContentPath = path.join( siteFolder, 'wp-content' );
	const relativePaths = await glob( '**/*', {
		cwd: wpContentPath,
		dot: true,
		follow: true,
		nodir: true,
		// Keep entry names forward-slashed on Windows
		posix: true,
	} );

	return new Promise( ( resolve, reject ) => {
		const output = fs.createWriteStream( archivePath );
		const archiveBuilder = new ZipArchive( {
			zlib: { level: ZIP_COMPRESSION_LEVEL },
		} );

		output.on( 'close', () => {
			resolve( archiveBuilder );
		} );
		archiveBuilder.on( 'error', ( error: Error ) => {
			reject( new LoggerError( __( 'Failed to create archive' ), error ) );
		} );

		archiveBuilder.pipe( output );

		for ( const relativePath of relativePaths ) {
			const archiveEntryPath = `wp-content/${ relativePath }`;
			if ( archiveEntryPath === STUDIO_LOADER_ARCHIVE_PATH ) {
				continue;
			}
			if ( deployIgnore.ignores( archiveEntryPath ) ) {
				continue;
			}
			// If the source path is a symlink, `Archiver.file()` appends a symlink to
			// the archive instead of the target file. We don't want this. By calling
			// realpath first, we ensure the source file data is always appended. This
			// is preferable to passing readable streams to `Archiver.append()`, which
			// can lead to EMFILE errors.
			try {
				const resolvedPath = fs.realpathSync( path.join( wpContentPath, relativePath ) );
				archiveBuilder.file( resolvedPath, { name: archiveEntryPath } );
			} catch ( error ) {
				// Dangling symlink. Skip it rather than aborting the whole archive.
				console.warn( `Skipping ${ archiveEntryPath }: ${ error }` );
			}
		}

		const wpConfigPath = path.join( siteFolder, 'wp-config.php' );
		if ( fs.existsSync( wpConfigPath ) ) {
			archiveBuilder.file( wpConfigPath, { name: 'wp-config.php' } );
		}

		archiveBuilder.finalize().catch( reject );
	} );
}

export async function cleanup( archivePath: string ): Promise< void > {
	// Wrap the cleanup logic in a setTimeout to avoid race conditions
	return new Promise( ( resolve ) => {
		setTimeout( () => {
			if ( fs.existsSync( archivePath ) ) {
				fs.unlinkSync( archivePath );
			}
			resolve();
		}, 0 );
	} );
}
