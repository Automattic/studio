import { EventEmitter } from 'events';
import fs from 'fs';
import zlib from 'zlib';
import * as tar from 'tar';
import { ImportEvents } from '../events';
import { BackupArchiveInfo, BackupExtractProgressEventData } from '../types';
import { BackupHandler, isFileAllowed } from './backup-handler-factory';

export class BackupHandlerTarGz extends EventEmitter implements BackupHandler {
	async listFiles( backup: BackupArchiveInfo ): Promise< string[] > {
		const filesSet = new Set< string >();
		await tar.t( {
			file: backup.path,
			onReadEntry: ( entry ) => {
				if ( isFileAllowed( entry.path ) ) {
					let path = entry.path;
					if ( entry.path.startsWith( '/' ) ) {
						path = path.slice( 1 );
					}
					filesSet.add( path );
				}
			},
		} );
		return Array.from( filesSet );
	}

	async extractFiles( file: BackupArchiveInfo, extractionDirectory: string ): Promise< void > {
		let totalSize: number;
		let processedSize = 0;
		let processedFiles = 0;
		let currentFile = '';

		try {
			totalSize = fs.statSync( file.path ).size;
		} catch ( error ) {
			this.emit( ImportEvents.BACKUP_EXTRACT_ERROR, error );
			throw error;
		}

		// Get total file count first
		const fileList = await this.listFiles( file );
		const totalFiles = fileList.length;

		return new Promise< void >( ( resolve, reject ) => {
			this.emit( ImportEvents.BACKUP_EXTRACT_START );
			fs.createReadStream( file.path )
				.on( 'data', ( chunk ) => {
					processedSize += chunk.length;
					this.emit( ImportEvents.BACKUP_EXTRACT_PROGRESS, {
						progress: processedSize / totalSize,
						processedFiles,
						totalFiles,
						currentFile,
						extractedBytes: processedSize,
						totalBytes: totalSize,
					} as BackupExtractProgressEventData );
				} )
				.on( 'error', ( error ) => {
					this.emit( ImportEvents.BACKUP_EXTRACT_ERROR, error );
					reject( error );
				} )
				.pipe( zlib.createGunzip() )
				.pipe(
					tar.extract( {
						cwd: extractionDirectory,
						onwarn: ( _code, message ) => {
							this.emit( ImportEvents.BACKUP_EXTRACT_WARNING, { message } );
						},
						onReadEntry: ( entry ) => {
							if ( isFileAllowed( entry.path ) ) {
								currentFile = entry.path;
								processedFiles++;
								this.emit( ImportEvents.BACKUP_EXTRACT_FILE_START, {
									currentFile,
									processedFiles,
									totalFiles,
								} as BackupExtractProgressEventData );
							}
						},
					} )
				)
				.on( 'finish', () => {
					this.emit( ImportEvents.BACKUP_EXTRACT_COMPLETE );
					resolve();
				} );
		} );
	}
}
