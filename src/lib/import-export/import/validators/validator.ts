import { EventEmitter } from 'events';
import { BackupContents } from 'src/lib/import-export/import/types';

export interface Validator extends Partial< EventEmitter > {
	canHandle( allFiles: string[] ): boolean;
	parseBackupContents( allFiles: string[], extractionDirectory: string ): BackupContents;
}
