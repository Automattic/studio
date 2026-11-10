import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { downloadFile } from '@studio/common/lib/download-file';
import { getSiteByFolder } from 'cli/lib/cli-config/sites';
import { DEFAULT_IMPORTER_OPTIONS, getImporter } from 'cli/lib/import-export/import/import-manager';
import { getBackupFileType } from 'cli/lib/import-export/utils';
import { keepSqliteIntegrationUpdated } from 'cli/lib/sqlite-integration';
import { ensureWpConfig } from './site-setup';
import type { SupportedPHPVersion } from '@studio/common/types/php-versions';
import type { ImportWordPressFilesStep, FileReference } from '@wp-playground/blueprints';
import type { ServerConfig } from 'cli/lib/types/wordpress-server-ipc';

export async function importWordPressFiles(
	config: ServerConfig,
	step: ImportWordPressFilesStep< FileReference >,
	blueprintPath: string,
	phpVersion: SupportedPHPVersion,
	signal: AbortSignal
): Promise< void > {
	if ( step.pathInZip && step.pathInZip !== '/' ) {
		throw new Error( 'Studio does not support importWordPressFiles with pathInZip.' );
	}
	const resource = step.wordPressFilesZip;
	const tempDir = await fs.mkdtemp( path.join( os.tmpdir(), 'studio-blueprint-import-' ) );
	try {
		signal.throwIfAborted();
		let archivePath: string;
		if ( resource.resource === 'url' ) {
			archivePath = path.join( tempDir, 'site.zip' );
			await downloadFile( resource.url, archivePath );
		} else if ( resource.resource === 'bundled' || resource.resource === 'vfs' ) {
			const base = await fs.realpath(
				resource.resource === 'bundled' ? path.dirname( blueprintPath ) : config.sitePath
			);
			const relativePath =
				resource.resource === 'vfs'
					? resource.path.replace( /^\/wordpress\//, '' )
					: resource.path.replace( /^[/\\]+/, '' );
			archivePath = await fs.realpath( path.resolve( base, relativePath ) );
			const relative = path.relative( base, archivePath );
			if (
				relative.startsWith( '..' + path.sep ) ||
				relative === '..' ||
				path.isAbsolute( relative )
			) {
				throw new Error( 'Blueprint snapshot must be inside its resource directory.' );
			}
		} else {
			throw new Error( `Unsupported Blueprint snapshot resource: ${ resource.resource }` );
		}
		signal.throwIfAborted();
		const site = await getSiteByFolder( config.sitePath );
		await getImporter(
			{ path: archivePath, type: getBackupFileType( archivePath ) },
			DEFAULT_IMPORTER_OPTIONS
		).import( site );
		await keepSqliteIntegrationUpdated( config.sitePath );
		await ensureWpConfig( config.sitePath, phpVersion, signal, config );
	} finally {
		await fs.rm( tempDir, { recursive: true, force: true } );
	}
}
