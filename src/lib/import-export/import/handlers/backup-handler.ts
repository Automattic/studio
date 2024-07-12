import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import AdmZip from 'adm-zip';
import * as tar from 'tar';
import { BackupArchiveInfo } from '../types';

export interface IBackupHandler {
	listFiles( file: BackupArchiveInfo ): Promise< string[] >;
	extractFiles( file: BackupArchiveInfo, extractionDirectory: string ): Promise< void >;
}

export class BackupHandler implements IBackupHandler {
	async listFiles( backup: BackupArchiveInfo ): Promise< string[] > {
		const backupFileExtension = path.extname( backup.path ).toLowerCase();
		if ( backup.type === 'application/gzip' && backupFileExtension === '.gz' ) {
			return this.listTarGzContents( backup.path );
		} else if ( backup.type === 'application/zip' && backupFileExtension === '.zip' ) {
			return this.listZipContents( backup.path );
		} else {
			throw new Error( 'Unsupported file format. Only .gz and .zip files are supported.' );
		}
	}

	private async listTarGzContents( backupPath: string ): Promise< string[] > {
		const files: string[] = [];
		await tar.t( {
			file: backupPath,
			onReadEntry: ( entry ) => files.push( entry.path ),
		} );
		return files;
	}

	private listZipContents( backupPath: string ): string[] {
		const zip = new AdmZip( backupPath );
		return zip.getEntries().map( ( entry ) => entry.entryName );
	}

	async extractFiles( file: BackupArchiveInfo, extractionDirectory: string ): Promise< void > {
		const backupFileExtension = path.extname( file.path ).toLowerCase();
		if ( file.type === 'application/gzip' && backupFileExtension === '.gz' ) {
			await this.extractTarGz( file.path, extractionDirectory );
		} else if ( file.type === 'application/zip' && backupFileExtension === '.zip' ) {
			await this.extractZip( file.path, extractionDirectory );
		}
	}

	private async extractTarGz( backupPath: string, extractionDirectory: string ): Promise< void > {
		return new Promise< void >( ( resolve, reject ) => {
			fs.createReadStream( backupPath )
				.pipe( zlib.createGunzip() )
				.pipe( tar.extract( { cwd: extractionDirectory } ) )
				.on( 'finish', resolve )
				.on( 'error', reject );
		} );
	}

	private extractZip( backupPath: string, extractionDirectory: string ): Promise< void > {
		return new Promise( ( resolve, reject ) => {
			const zip = new AdmZip( backupPath );
			zip.extractAllToAsync( extractionDirectory, true, undefined, ( error?: Error ) => {
				if ( error ) {
					reject( error );
				}
				resolve();
			} );
		} );
	}
}
