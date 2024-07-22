import AdmZip from 'adm-zip';
import { BackupArchiveInfo } from '../types';
import { BackupHandler, isFileAllowed } from './backup-handler-factory';

export class BackupHandlerZip implements BackupHandler {
	async listFiles( backup: BackupArchiveInfo ): Promise< string[] > {
		const zip = new AdmZip( backup.path );
		return zip
			.getEntries()
			.map( ( entry ) => entry.entryName )
			.filter( isFileAllowed );
	}

	async extractFiles( file: BackupArchiveInfo, extractionDirectory: string ): Promise< void > {
		return new Promise( ( resolve, reject ) => {
			const zip = new AdmZip( file.path );
			zip.extractAllToAsync( extractionDirectory, true, undefined, ( error?: Error ) => {
				if ( error ) {
					reject( error );
				}
				resolve();
			} );
		} );
	}
}
