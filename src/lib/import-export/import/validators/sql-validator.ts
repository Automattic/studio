import path from 'path';
import { BackupContents } from '../types';
import { Validator } from './Validator';

export class SqlValidator implements Validator {
	canHandle( fileList: string[] ): boolean {
		return fileList.length === 1 && fileList[ 0 ].endsWith( '.sql' );
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

		for ( const file of fileList ) {
			const fullPath = path.join( extractionDirectory, file );

			if ( file.endsWith( '.sql' ) ) {
				extractedBackup.sqlFiles.push( fullPath );
			}
		}
		return extractedBackup;
	}
}
