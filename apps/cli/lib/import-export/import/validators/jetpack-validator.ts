import path from 'path';
import { ImportExportEventEmitter } from '../../events';
import { BackupContents } from '../types';
import { Validator } from './validator';

export class JetpackValidator extends ImportExportEventEmitter implements Validator {
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
			} else if (
				file.startsWith( 'wp-content/' ) &&
				! file.startsWith( 'wp-content/database/' )
			) {
				extractedBackup.wpContentFiles.push( fullPath );
			} else if ( file === 'studio.json' || file === 'meta.json' ) {
				extractedBackup.metaFile = fullPath;
			}
		}
		extractedBackup.sqlFiles.sort( ( a: string, b: string ) =>
			path.basename( a ).localeCompare( path.basename( b ) )
		);
		return extractedBackup;
	}
}
