import path from 'path';
import { ImportExportEventEmitter } from '../../events';
import { BackupContents } from '../types';
import { Validator } from './validator';

export class XmlValidator extends ImportExportEventEmitter implements Validator {
	canHandle( fileList: string[] ): boolean {
		return fileList.length === 1 && fileList[ 0 ].toLowerCase().endsWith( '.xml' );
	}

	parseBackupContents( fileList: string[], extractionDirectory: string ): BackupContents {
		const extractedBackup: BackupContents = {
			extractionDirectory,
			sqlFiles: [],
			wpConfig: '',
			wpContentFiles: [],
			wpContentDirectory: '',
			wxrFiles: [],
		};

		for ( const file of fileList ) {
			if ( file.toLowerCase().endsWith( '.xml' ) ) {
				extractedBackup.wxrFiles?.push( path.join( extractionDirectory, file ) );
			}
		}
		return extractedBackup;
	}
}
