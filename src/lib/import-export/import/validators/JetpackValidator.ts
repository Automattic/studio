import path from 'path';
import { BackupContents } from '../types';
import { Validator } from './Validator';

export class JetpackValidator implements Validator {
	canHandle( fileList: string[] ): boolean {
		const requiredDirs = [ 'sql', 'wp-content/uploads', 'wp-content/plugins', 'wp-content/themes' ];
		return (
			requiredDirs.some( ( dir ) => fileList.some( ( file ) => file.startsWith( dir + '/' ) ) ) &&
			fileList.some( ( file ) => file.startsWith( 'sql/' ) && file.endsWith( '.sql' ) )
		);
	}

	parseBackupContents( fileList: string[], extractionDirectory: string ): BackupContents {
		const extractedBackup: BackupContents = {
			extractionDirectory: extractionDirectory,
			sqlFiles: [],
			wpContent: {
				uploads: [],
				plugins: [],
				themes: [],
			},
		};
		/* File rules:
		 * - Ignore wp-config.php
		 * - Accept .zip in addition to tar.gz ( Handled by backup handler )
		 * - Do not reject the archive that includes core WP files in addition to files and directories required by Jetpack format, and ignore those instead.
		 * - Support optional meta file, e.g., studio.json, that stores desired PHP and WP versions.
		 * */

		for ( const file of fileList ) {
			// Ignore wp-config.php
			if ( file === 'wp-config.php' ) continue;

			const fullPath = path.join( extractionDirectory, file );

			if ( file.startsWith( 'sql/' ) && file.endsWith( '.sql' ) ) {
				extractedBackup.sqlFiles.push( fullPath );
			} else if ( file.startsWith( 'wp-content/uploads/' ) ) {
				extractedBackup.wpContent.uploads.push( fullPath );
			} else if ( file.startsWith( 'wp-content/plugins/' ) ) {
				extractedBackup.wpContent.plugins.push( fullPath );
			} else if ( file.startsWith( 'wp-content/themes/' ) ) {
				extractedBackup.wpContent.themes.push( fullPath );
			} else if ( file === 'studio.json' ) {
				extractedBackup.metaFile = fullPath;
			}
		}
		extractedBackup.sqlFiles.sort( ( a: string, b: string ) =>
			path.basename( a ).localeCompare( path.basename( b ) )
		);

		return extractedBackup;
	}
}
