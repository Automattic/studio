import fs from 'fs';
import { promisify } from 'util';
import zlib from 'zlib';
import * as tar from 'tar';
import { BackupArchiveInfo } from '../types';
import { IBackupHandler } from './backup-handler-factory';

const unzip = promisify( zlib.unzip );

export class BackupHandlerTarGz implements IBackupHandler {
	async listFiles( backup: BackupArchiveInfo ): Promise< string[] > {
		const files: string[] = [];
		await tar.t( {
			file: backup.path,
			onReadEntry: ( entry ) => files.push( entry.path ),
		} );
		return files;
	}

	async extractFiles( file: BackupArchiveInfo, extractionDirectory: string ): Promise< void > {
		return new Promise< void >( ( resolve, reject ) => {
			fs.createReadStream( file.path )
				.pipe( zlib.createGunzip() )
				.pipe( tar.extract( { cwd: extractionDirectory } ) )
				.on( 'finish', resolve )
				.on( 'error', reject );
		} );
	}
}
