import { EventEmitter } from 'events';
import path from 'path';
import { ImportEvents } from '../events';
import { BackupContents } from '../types';
import { Validator } from './validator';

export class LocalValidator extends EventEmitter implements Validator {
	canHandle( fileList: string[] ): boolean {
		const requiredDirs = [
			'app/sql',
			'app/public/wp-content/uploads',
			'app/public/wp-content/plugins',
			'app/public/wp-content/themes',
		];
		return (
			requiredDirs.some( ( dir ) => fileList.some( ( file ) => file.startsWith( dir + '/' ) ) ) &&
			fileList.some( ( file ) => file.startsWith( 'app/sql/' ) && file.endsWith( '.sql' ) )
		);
	}

	parseBackupContents( fileList: string[], extractionDirectory: string ): BackupContents {
		this.emit( ImportEvents.IMPORT_VALIDATION_START );
		const extractedBackup: BackupContents = {
			extractionDirectory: extractionDirectory,
			sqlFiles: [],
			wpConfig: '',
			wpContent: {
				uploads: [],
				plugins: [],
				themes: [],
			},
			wpContentDirectory: 'app/public/wp-content',
		};
		/* File rules:
		 * - Accept .zip
		 * - Do not reject the archive that includes core WP files, and ignore those instead.
		 * - Support optional meta file, local-site.json, that stores desired PHP and WP versions.
		 * */

		for ( const file of fileList ) {
			const fullPath = path.join( extractionDirectory, file );
			if ( file.startsWith( 'app/public/' ) && file.endsWith( 'wp-config.php' ) ) {
				extractedBackup.wpConfig = fullPath;
				continue;
			}

			if ( file.startsWith( 'app/sql/' ) && file.endsWith( '.sql' ) ) {
				extractedBackup.sqlFiles.push( fullPath );
			} else if ( file.startsWith( 'app/public/wp-content/uploads/' ) ) {
				extractedBackup.wpContent.uploads.push( fullPath );
			} else if ( file.startsWith( 'app/public/wp-content/plugins/' ) ) {
				extractedBackup.wpContent.plugins.push( fullPath );
			} else if ( file.startsWith( 'app/public/wp-content/themes/' ) ) {
				extractedBackup.wpContent.themes.push( fullPath );
			} else if ( file === 'local-site.json' ) {
				extractedBackup.metaFile = fullPath;
			}
		}
		extractedBackup.sqlFiles.sort( ( a: string, b: string ) =>
			path.basename( a ).localeCompare( path.basename( b ) )
		);

		this.emit( ImportEvents.IMPORT_VALIDATION_COMPLETE );
		return extractedBackup;
	}
}
