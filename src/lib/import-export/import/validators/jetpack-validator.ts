import { EventEmitter } from 'events';
import path from 'path';
import { ImportEvents } from 'src/lib/import-export/import/events';
import { BackupContents } from 'src/lib/import-export/import/types';
import { Validator } from 'src/lib/import-export/import/validators/validator';

export class JetpackValidator extends EventEmitter implements Validator {
	canHandle( fileList: string[] ): boolean {
		const optionalDirs = [
			'sql',
			'wp-content',
			'wp-content/uploads',
			'wp-content/plugins',
			'wp-content/themes',
		];
		const optionalFiles = [ 'wp-config.php', 'meta.json' ];

		const hasOptionalDir = optionalDirs.some( ( dir ) =>
			fileList.some( ( file ) => file.startsWith( dir + '/' ) )
		);
		const hasOptionalFile = optionalFiles.some( ( file ) => fileList.includes( file ) );

		return hasOptionalDir || hasOptionalFile;
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
		 * - Accept .zip in addition to tar.gz ( Handled by backup handler )
		 * - Do not reject the archive that includes core WP files in addition to files and directories required by Jetpack format, and ignore those instead.
		 * - Support optional meta file, e.g., meta.json, that stores desired PHP and WP versions.
		 * */

		for ( const file of fileList ) {
			const fullPath = path.join( extractionDirectory, file );
			if ( file === 'wp-config.php' ) {
				extractedBackup.wpConfig = fullPath;
				continue;
			}

			if ( file.startsWith( 'sql/' ) && file.endsWith( '.sql' ) ) {
				extractedBackup.sqlFiles.push( fullPath );
			} else if ( file.startsWith( 'wp-content/' ) ) {
				extractedBackup.wpContentFiles.push( fullPath );
			} else if ( file === 'studio.json' || file === 'meta.json' ) {
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
