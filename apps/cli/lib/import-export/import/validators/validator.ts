import { BackupContents } from '../types';
import type { ImportExportEventEmitter } from '../../events';

export interface Validator extends ImportExportEventEmitter {
	canHandle( allFiles: string[] ): boolean;
	parseBackupContents( allFiles: string[], extractionDirectory: string ): BackupContents;
}
