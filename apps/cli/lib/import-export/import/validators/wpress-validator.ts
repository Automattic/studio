import path from 'path';
import { ImportExportEventEmitter } from '../../events';
import { BackupContents } from '../types';
import { Validator } from './validator';

export class WpressValidator extends ImportExportEventEmitter implements Validator {
	canHandle( fileList: string[] ): boolean {
		const requiredFiles = [ 'database.sql', 'package.json' ];
		const optionalDirs = [ 'uploads', 'plugins', 'themes', 'fonts' ];
		return (
			requiredFiles.every( ( file ) => fileList.includes( file ) ) &&
			optionalDirs.some( ( dir ) => fileList.some( ( file ) => file.startsWith( dir + path.sep ) ) )
		);
	}

	parseBackupContents( fileList: string[], extractionDirectory: string ): BackupContents {
		const extractedBackup: BackupContents = {
			extractionDirectory,
			sqlFiles: [],
			wpConfig: '',
			wpContentFiles: [],
			wpContentDirectory: '',
		};
		/* File rules:
		 * - Accept .wpress
		 * - Must include database.sql in the root
		 * - Support optional directories: uploads, plugins, themes, mu-plugins, fonts
		 * */

		for ( const file of fileList ) {
			const fullPath = path.join( extractionDirectory, file );
			if ( file === 'database.sql' ) {
				extractedBackup.sqlFiles.push( fullPath );
			} else if (
				file.startsWith( 'uploads' + path.sep ) ||
				file.startsWith( 'plugins' + path.sep ) ||
				file.startsWith( 'themes' + path.sep ) ||
				file.startsWith( 'mu-plugins' + path.sep ) ||
				file.startsWith( 'fonts' + path.sep )
			) {
				extractedBackup.wpContentFiles.push( fullPath );
			} else if ( file === 'package.json' ) {
				extractedBackup.metaFile = fullPath;
			}
		}
		extractedBackup.sqlFiles.sort( ( a: string, b: string ) =>
			path.basename( a ).localeCompare( path.basename( b ) )
		);
		return extractedBackup;
	}
}
