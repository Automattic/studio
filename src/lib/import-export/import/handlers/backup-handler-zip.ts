import { EventEmitter } from 'events';
import fs from 'fs';
import path from 'path';
import { promisify } from 'util';
import fse from 'fs-extra';
import yauzl from 'yauzl';
import { ImportEvents } from '../events';
import { BackupArchiveInfo, BackupExtractProgressEventData } from '../types';
import { BackupHandler, isFileAllowed } from './backup-handler-factory';

const openZip = promisify< string, yauzl.Options, yauzl.ZipFile >( yauzl.open );

export class BackupHandlerZip extends EventEmitter implements BackupHandler {
	async listFiles( backup: BackupArchiveInfo ): Promise< string[] > {
		const zipFile = await openZip( backup.path, { lazyEntries: true } );
		const fileNames: string[] = [];

		return new Promise( ( resolve, reject ) => {
			zipFile.on( 'entry', ( entry ) => {
				if ( isFileAllowed( entry.fileName ) ) {
					fileNames.push( entry.fileName );
				}
				zipFile.readEntry();
			} );

			zipFile.on( 'end', () => {
				resolve( fileNames );
			} );

			zipFile.on( 'error', reject );
			zipFile.readEntry();
		} );
	}

	async extractFiles( file: BackupArchiveInfo, extractionDirectory: string ): Promise< void > {
		const zipFile = await openZip( file.path, { lazyEntries: true } );
		const openReadStream = promisify( zipFile.openReadStream.bind( zipFile ) );
		const totalSize = fs.statSync( file.path ).size;
		let processedSize = 0;

		this.emit( ImportEvents.BACKUP_EXTRACT_START );

		return new Promise( ( resolve, reject ) => {
			zipFile.on( 'entry', async ( entry ) => {
				if ( ! isFileAllowed( entry.fileName ) ) {
					zipFile.readEntry();
					return;
				}

				const fullPath = path.join( extractionDirectory, entry.fileName );
				await fse.ensureDir( path.dirname( fullPath ) );

				if ( entry.fileName.endsWith( '/' ) ) {
					zipFile.readEntry();
					return;
				}

				const readStream = await openReadStream( entry );
				const writeStream = fs.createWriteStream( fullPath );

				readStream.on( 'data', ( chunk ) => {
					processedSize += chunk.length;
					this.emit( ImportEvents.BACKUP_EXTRACT_PROGRESS, {
						progress: processedSize / totalSize,
					} as BackupExtractProgressEventData );
				} );

				writeStream.on( 'finish', () => {
					zipFile.readEntry();
				} );

				readStream.pipe( writeStream );
			} );

			zipFile.on( 'end', () => {
				this.emit( ImportEvents.BACKUP_EXTRACT_COMPLETE );
				resolve();
			} );

			zipFile.on( 'error', ( error ) => {
				this.emit( ImportEvents.BACKUP_EXTRACT_ERROR, { error } );
				reject( error );
			} );

			zipFile.readEntry();
		} );
	}
}
