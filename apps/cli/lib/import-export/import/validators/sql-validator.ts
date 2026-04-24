import path from 'path';
import { ImportExportEventEmitter } from '../../events';
import { BackupContents } from '../types';
import { Validator } from './validator';

export class SqlValidator extends ImportExportEventEmitter implements Validator {
	canHandle( fileList: string[] ): boolean {
		return fileList.length === 1 && fileList[ 0 ].endsWith( '.sql' );
	}

	parseBackupContents( fileList: string[], extractionDirectory: string ): BackupContents {
		const extractedBackup: BackupContents = {
			extractionDirectory: extractionDirectory,
			sqlFiles: [],
			wpConfig: '',
			wpContentFiles: [],
			wpContentDirectory: '',
		};

		for ( const file of fileList ) {
			const fullPath = path.join( extractionDirectory, file );

			if ( file.endsWith( '.sql' ) ) {
				extractedBackup.sqlFiles.push( fullPath );
			}
		}
		return extractedBackup;
	}
}
