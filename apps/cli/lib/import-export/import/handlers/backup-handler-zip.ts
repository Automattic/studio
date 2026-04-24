import fs from 'fs';
import path from 'path';
import { promisify } from 'util';
import { ImportEvents } from '@studio/common/lib/import-export-events';
import fse from 'fs-extra';
import yauzl from 'yauzl';
import { ImportExportEventEmitter } from '../../events';
import { BackupArchiveInfo } from '../types';
import { BackupHandler, isFileAllowed } from './backup-handler-factory';

const openZip = promisify< string, yauzl.Options, yauzl.ZipFile >( yauzl.open );

export class BackupHandlerZip extends ImportExportEventEmitter implements BackupHandler {
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
			const failOnce = ( err: Error ) => {
				if ( ! extractionFailed ) {
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
				} );

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
						failOnce( err );
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
						} );
					} );

					writeStream.once( 'finish', () => {
						if ( ! extractionFailed ) {
							processedFiles++;
							zipFile.readEntry();
						}
					} );

					readStream.pipe( writeStream );
				} catch ( err ) {
					if ( err instanceof Error ) {
						failOnce( err );
					}
				}
			} );

			zipFile.on( 'end', () => {
				if ( ! extractionFailed ) {
					this.emit( ImportEvents.BACKUP_EXTRACT_COMPLETE );
					resolve();
				}
			} );

			zipFile.on( 'error', ( error ) => {
				failOnce( error );
				this.emit( ImportEvents.BACKUP_EXTRACT_ERROR, error );
			} );

			zipFile.readEntry();
		} );
	}
}
