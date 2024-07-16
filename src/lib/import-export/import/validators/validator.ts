import { BackupContents } from '../types';

export interface Validator {
	canHandle( allFiles: string[] ): boolean;
	parseBackupContents( allFiles: string[], extractionDirectory: string ): BackupContents;
}
