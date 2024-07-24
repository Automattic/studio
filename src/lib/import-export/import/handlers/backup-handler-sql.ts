import { EventEmitter } from 'events';
import fs from 'fs';
import path from 'path';
import { ImportEvents } from '../events';
import { BackupArchiveInfo } from '../types';
import { BackupHandler } from './backup-handler-factory';

export class BackupHandlerSql extends EventEmitter implements BackupHandler {
	constructor() {
		super();
	}
	async listFiles( backup: BackupArchiveInfo ): Promise< string[] > {
		return [ path.basename( backup.path ) ];
	}

	async extractFiles( file: BackupArchiveInfo, extractionDirectory: string ): Promise< void > {
		this.emit( ImportEvents.BACKUP_EXTRACT_START );
		const destPath = path.join( extractionDirectory, path.basename( file.path ) );
		this.emit( ImportEvents.BACKUP_EXTRACT_PROGRESS );
		await fs.promises.copyFile( file.path, destPath );
		this.emit( ImportEvents.BACKUP_EXTRACT_COMPLETE );
	}
}
