import { EventEmitter } from 'events';
import fs from 'fs';
import path from 'path';
import { promisify } from 'util';
import * as Sentry from '@sentry/electron/main';
import fse from 'fs-extra';
import yauzl from 'yauzl';
import { ImportEvents } from 'src/lib/import-export/import/events';
import {
	BackupHandler,
	isFileAllowed,
} from 'src/lib/import-export/import/handlers/backup-handler-factory';
import {
	BackupArchiveInfo,
	BackupExtractProgressEventData,
} from 'src/lib/import-export/import/types';

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
		let processedFiles = 0;
		const totalFiles = zipFile.entryCount;

		this.emit( ImportEvents.BACKUP_EXTRACT_START );

		return new Promise( ( resolve, reject ) => {
			let extractionFailed = false;
			const failOnce = ( err: Error, context?: Record< string, unknown > ) => {
				if ( ! extractionFailed ) {
					Sentry.captureException( err, {
						extra: context,
					} );
					extractionFailed = true;
					reject( err );
				}
			};

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

				this.emit( ImportEvents.BACKUP_EXTRACT_FILE_START, {
					currentFile: entry.fileName,
					processedFiles,
					totalFiles,
				} as BackupExtractProgressEventData );

				try {
					const readStream = await openReadStream( entry );
					const writeStream = fs.createWriteStream( fullPath );

					const onError = ( err: Error ) => {
						if ( ! readStream.destroyed ) {
							readStream.destroy();
						}
						if ( ! writeStream.destroyed ) {
							writeStream.destroy();
						}
						failOnce( err, { fullPath, entry: entry.fileName, filePath: file.path } );
					};

					readStream.once( 'error', onError );
					writeStream.once( 'error', onError );

					readStream.on( 'data', ( chunk ) => {
						processedSize += chunk.length;
						this.emit( ImportEvents.BACKUP_EXTRACT_PROGRESS, {
							progress: processedSize / totalSize,
							processedFiles,
							totalFiles,
							currentFile: entry.fileName,
							extractedBytes: processedSize,
							totalBytes: totalSize,
						} as BackupExtractProgressEventData );
					} );

					writeStream.once( 'finish', () => {
						if ( ! extractionFailed ) {
							processedFiles++;
							zipFile.readEntry();
						}
					} );

					readStream.pipe( writeStream );
				} catch ( err ) {
					failOnce( err as Error, { fullPath, entry: entry.fileName, filePath: file.path } );
				}
			} );

			zipFile.on( 'end', () => {
				if ( ! extractionFailed ) {
					this.emit( ImportEvents.BACKUP_EXTRACT_COMPLETE );
					resolve();
				}
			} );

			zipFile.on( 'error', ( error ) => {
				failOnce( error, { filePath: file.path } );
				this.emit( ImportEvents.BACKUP_EXTRACT_ERROR, { error } );
			} );

			zipFile.readEntry();
		} );
	}
}
