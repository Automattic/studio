import type { ProgressData } from 'archiver';
import type { EventEmitter } from 'events';

export interface ExportOptions {
	sitePath: string;
	backupFile: string;
	includes: { [ index in ExportOptionsIncludes ]: boolean };
}

export type ExportOptionsIncludes = BackupContentsCategory | 'database';

export interface BackupContents {
	backupFile: string;
	sqlFiles: string[];
	wpContent: { [ index in BackupContentsCategory ]: string[] };
	wpConfigFile?: string;
}

export type BackupContentsCategory = 'uploads' | 'plugins' | 'themes';

export interface ExportValidator extends Partial< EventEmitter > {
	canHandle( files: string[] ): boolean;
	filterFiles( files: string[], options: ExportOptions ): BackupContents;
}

export interface Exporter extends Partial< EventEmitter > {
	export( options: ExportOptions ): Promise< void >;
}

export type NewExporter = new ( backup: BackupContents ) => Exporter;

export interface ExporterOption {
	validator: ExportValidator;
	exporter: NewExporter;
}

export interface BackupCreateProgressEventData {
	progress: ProgressData;
}
