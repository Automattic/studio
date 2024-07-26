import { EventEmitter } from 'events';
import path from 'path';
import { ImportEvents } from '../events';
import { BackupContents } from '../types';
import { Validator } from './validator';

export class SqlValidator extends EventEmitter implements Validator {
	canHandle( fileList: string[] ): boolean {
		return fileList.length === 1 && fileList[ 0 ].endsWith( '.sql' );
	}

	parseBackupContents( fileList: string[], extractionDirectory: string ): BackupContents {
		this.emit( ImportEvents.IMPORT_VALIDATION_START );
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
		this.emit( ImportEvents.IMPORT_VALIDATION_COMPLETE );
		return extractedBackup;
	}
}
