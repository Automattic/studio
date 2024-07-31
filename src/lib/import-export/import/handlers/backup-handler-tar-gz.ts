import { EventEmitter } from 'events';
import fs from 'fs';
import zlib from 'zlib';
import * as tar from 'tar';
import { ImportEvents } from '../events';
import { BackupArchiveInfo, BackupExtractProgressEventData } from '../types';
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
		let totalSize: number;
		let processedSize = 0;

		try {
			totalSize = fs.statSync( file.path ).size;
		} catch ( error ) {
			this.emit( ImportEvents.BACKUP_EXTRACT_ERROR, { error } );
			throw error;
		}

		return new Promise< void >( ( resolve, reject ) => {
			this.emit( ImportEvents.BACKUP_EXTRACT_START );
			fs.createReadStream( file.path )
				.on( 'data', ( chunk ) => {
					processedSize += chunk.length;
					this.emit( ImportEvents.BACKUP_EXTRACT_PROGRESS, {
						progress: processedSize / totalSize,
					} as BackupExtractProgressEventData );
				} )
				.on( 'error', ( error ) => {
					this.emit( ImportEvents.BACKUP_EXTRACT_ERROR, { error } );
					reject( error );
				} )
				.pipe( zlib.createGunzip() )
				.pipe( tar.extract( { cwd: extractionDirectory } ) )
				.on( 'finish', () => {
					this.emit( ImportEvents.BACKUP_EXTRACT_COMPLETE );
					resolve();
				} );
		} );
	}
}
