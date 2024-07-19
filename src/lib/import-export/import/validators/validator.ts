import { EventEmitter } from 'events';
import { BackupContents } from '../types';

export interface Validator extends Partial< EventEmitter >{
	canHandle( allFiles: string[] ): boolean;
	parseBackupContents( allFiles: string[], extractionDirectory: string ): BackupContents;
}
