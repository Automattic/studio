import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import * as unzipper from 'unzipper';
import { ImportEvents } from '../events';
import { BackupArchiveInfo, BackupExtractProgressEventData } from '../types';
import { BackupHandler, isFileAllowed } from './backup-handler-factory';

export class BackupHandlerZip extends EventEmitter implements BackupHandler {
	async listFiles( backup: BackupArchiveInfo ): Promise< string[] > {
		const fileList: string[] = [];
		return new Promise( ( resolve, reject ) => {
			fs.createReadStream( backup.path )
				.pipe( unzipper.Parse() )
				.on( 'entry', ( entry ) => {
					const fileName = entry.path;
					if ( isFileAllowed( fileName ) ) {
						fileList.push( fileName );
					}
					entry.autodrain();
				} )
				.on( 'close', () => resolve( fileList ) )
				.on( 'error', reject );
		} );
	}

	async extractFiles( file: BackupArchiveInfo, extractionDirectory: string ): Promise< void > {
		this.emit( ImportEvents.BACKUP_EXTRACT_START );
		this.emit( ImportEvents.BACKUP_EXTRACT_PROGRESS, {
			progress: 0,
		} as BackupExtractProgressEventData );

		return new Promise( ( resolve, reject ) => {
			fs.createReadStream( file.path )
				.pipe( unzipper.Parse() )
				.on( 'entry', ( entry ) => {
					const fileName = entry.path;
					const type = entry.type;
					const extractPath = path.join( extractionDirectory, fileName );

					if ( type === 'Directory' ) {
						fs.mkdirSync( extractPath, { recursive: true } );
						entry.autodrain();
					} else if ( isFileAllowed( fileName ) ) {
						entry.pipe( fs.createWriteStream( extractPath ) );
					} else {
						entry.autodrain();
					}
				} )
				.on( 'close', () => {
					this.emit( ImportEvents.BACKUP_EXTRACT_PROGRESS, {
						progress: 1,
					} as BackupExtractProgressEventData );
					this.emit( ImportEvents.BACKUP_EXTRACT_COMPLETE );
					resolve();
				} )
				.on( 'error', ( error ) => {
					this.emit( ImportEvents.BACKUP_EXTRACT_ERROR, { error } );
					reject( error );
				} );
		} );
	}
}
