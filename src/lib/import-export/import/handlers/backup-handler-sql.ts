import { EventEmitter } from 'events';
import fs from 'fs';
import path from 'path';
import { ImportEvents } from 'src/lib/import-export/import/events';
import { BackupHandler } from 'src/lib/import-export/import/handlers/backup-handler-factory';
import { BackupArchiveInfo } from 'src/lib/import-export/import/types';

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
