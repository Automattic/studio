import fs from 'fs';
import path from 'path';
import { BackupArchiveInfo } from '../types';
import { BackupHandler } from './backup-handler-factory';

export class BackupHandlerSql implements BackupHandler {
	async listFiles( backup: BackupArchiveInfo ): Promise< string[] > {
		return [ path.basename( backup.path ) ];
	}

	async extractFiles( file: BackupArchiveInfo, extractionDirectory: string ): Promise< void > {
		const destPath = path.join( extractionDirectory, path.basename( file.path ) );
		await fs.promises.copyFile( file.path, destPath );
	}
}
