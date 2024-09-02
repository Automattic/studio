import { EventEmitter } from 'events';
import path from 'path';
import { ImportEvents } from '../events';
import { BackupContents } from '../types';
import { Validator } from './validator';

export class WpressValidator extends EventEmitter implements Validator {
	canHandle( fileList: string[] ): boolean {
		const requiredFiles = [ 'database.sql' ];
		const optionalDirs = [ 'uploads', 'plugins', 'themes' ];
		return (
			requiredFiles.every( ( file ) => fileList.includes( file ) ) &&
			fileList.some( ( file ) => optionalDirs.some( ( dir ) => file.startsWith( dir + '/' ) ) )
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
			wpContentDirectory: '',
		};
		/* File rules:
		 * - Accept .wpress
		 * - Must include database.sql in the root
		 * - Support optional directories: uploads, plugins, themes, mu-plugins
		 * */

		for ( const file of fileList ) {
			const fullPath = path.join( extractionDirectory, file );
			if ( file === 'database.sql' ) {
				extractedBackup.sqlFiles.push( fullPath );
			} else if ( file.startsWith( 'uploads/' ) ) {
				extractedBackup.wpContent.uploads.push( fullPath );
			} else if ( file.startsWith( 'plugins/' ) ) {
				extractedBackup.wpContent.plugins.push( fullPath );
			} else if ( file.startsWith( 'themes/' ) ) {
				extractedBackup.wpContent.themes.push( fullPath );
			}
		}
		extractedBackup.sqlFiles.sort( ( a: string, b: string ) =>
			path.basename( a ).localeCompare( path.basename( b ) )
		);

		this.emit( ImportEvents.IMPORT_VALIDATION_COMPLETE );
		return extractedBackup;
	}
}
