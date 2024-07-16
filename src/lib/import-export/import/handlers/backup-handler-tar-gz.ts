import fs from 'fs';
import zlib from 'zlib';
import * as tar from 'tar';
import { BackupArchiveInfo } from '../types';
import { BackupHandler } from './backup-handler-factory';

export class BackupHandlerTarGz implements BackupHandler {
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
