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
		const fileName = path.basename( file.path );
		const destPath = path.join( extractionDirectory, fileName );

		this.emit( ImportEvents.BACKUP_EXTRACT_START, {
			progress: 0,
			totalFiles: 1,
			processedFiles: 0,
		} );

		this.emit( ImportEvents.BACKUP_EXTRACT_FILE_START, {
			progress: 0,
			processedFiles: 0,
			totalFiles: 1,
			currentFile: fileName,
		} );

		await fs.promises.copyFile( file.path, destPath );

		this.emit( ImportEvents.BACKUP_EXTRACT_PROGRESS, {
			progress: 100,
			processedFiles: 1,
			totalFiles: 1,
			currentFile: fileName,
		} );

		this.emit( ImportEvents.BACKUP_EXTRACT_COMPLETE, {
			progress: 100,
			processedFiles: 1,
			totalFiles: 1,
		} );
	}
}
