import { EventEmitter } from 'events';
import fs from 'fs';
import zlib from 'zlib';
import * as tar from 'tar';
import { ImportEvents } from '../events';
import { BackupArchiveInfo } from '../types';
import { BackupHandler, isFileAllowed } from './backup-handler-factory';

export class BackupHandlerTarGz extends EventEmitter implements BackupHandler {
	async listFiles( backup: BackupArchiveInfo ): Promise< string[] > {
		const files: string[] = [];
		await tar.t( {
			file: backup.path,
			onReadEntry: ( entry ) => isFileAllowed( entry.path ) && files.push( entry.path ),
		} );
		return files;
	}

	async extractFiles( file: BackupArchiveInfo, extractionDirectory: string ): Promise< void > {
		return new Promise< void >( ( resolve, reject ) => {
			this.emit( ImportEvents.BACKUP_HANDLER_START );
			fs.createReadStream( file.path )
				.pipe( zlib.createGunzip() )
				.pipe( tar.extract( { cwd: extractionDirectory } ) )
				.on( 'finish', () => {
					this.emit( ImportEvents.BACKUP_HANDLER_COMPLETE );
					resolve();
				} )
				.on( 'data', () => {
					this.emit( ImportEvents.BACKUP_HANDLER_PROGRESS );
				} )
				.on( 'error', ( error ) => {
					this.emit( ImportEvents.BACKUP_HANDLER_ERROR, { error } );
					reject( error );
				} );
		} );
	}
}
