import { EventEmitter } from 'events';
import AdmZip from 'adm-zip';
import { ImportEvents } from '../events';
import { BackupArchiveInfo } from '../types';
import { BackupHandler, isFileAllowed } from './backup-handler-factory';

export class BackupHandlerZip extends EventEmitter implements BackupHandler {
	async listFiles( backup: BackupArchiveInfo ): Promise< string[] > {
		const zip = new AdmZip( backup.path );
		return zip
			.getEntries()
			.map( ( entry ) => entry.entryName )
			.filter( isFileAllowed );
	}

	async extractFiles( file: BackupArchiveInfo, extractionDirectory: string ): Promise< void > {
		this.emit( ImportEvents.BACKUP_HANDLER_START );
		return new Promise( ( resolve, reject ) => {
			this.emit( ImportEvents.BACKUP_HANDLER_PROGRESS );
			const zip = new AdmZip( file.path );
			zip.extractAllToAsync( extractionDirectory, true, undefined, ( error?: Error ) => {
				if ( error ) {
					this.emit( ImportEvents.BACKUP_HANDLER_ERROR, { error } );
					reject( error );
				}
				this.emit( ImportEvents.BACKUP_HANDLER_COMPLETE );
				resolve();
			} );
		} );
	}
}
