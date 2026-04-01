import { EventEmitter } from 'events';
import path from 'path';
import { ImportEvents } from '../events';
import { BackupContents } from '../types';
import { Validator } from './validator';

export class PlaygroundValidator extends EventEmitter implements Validator {
	canHandle( fileList: string[] ): boolean {
		const requiredDirs = [
			'wp-content/database',
			'wp-content/uploads',
			'wp-content/plugins',
			'wp-content/themes',
		];
		return (
			requiredDirs.some( ( dir ) => fileList.some( ( file ) => file.startsWith( dir + '/' ) ) ) &&
			fileList.some(
				( file ) => file.startsWith( 'wp-content/database' ) && file.endsWith( '.ht.sqlite' )
			)
		);
	}

	parseBackupContents( fileList: string[], extractionDirectory: string ): BackupContents {
		this.emit( ImportEvents.IMPORT_VALIDATION_START );
		const extractedBackup: BackupContents = {
			extractionDirectory: extractionDirectory,
			sqlFiles: [],
			wpConfig: '',
			wpContentFiles: [],
			wpContentDirectory: 'wp-content',
		};

		/* File rules:
		 * - Accept .zip
		 * - Do not reject the archive that includes core WP files, and ignore those instead.
		 * - Support .ht.sqlite database files
		 * */

		for ( const file of fileList ) {
			const fullPath = path.join( extractionDirectory, file );
			if ( file === 'wp-config.php' ) {
				extractedBackup.wpConfig = fullPath;
				continue;
			}

			if ( file.startsWith( 'wp-content/database' ) && file.endsWith( '.ht.sqlite' ) ) {
				extractedBackup.sqlFiles.push( fullPath );
			} else if ( file.startsWith( 'wp-content/' ) ) {
				extractedBackup.wpContentFiles.push( fullPath );
			}
		}
		this.emit( ImportEvents.IMPORT_VALIDATION_COMPLETE );
		return extractedBackup;
	}
}
