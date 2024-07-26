import { EventEmitter } from 'events';

export interface ExportOptions {
	sitePath: string;
	backupFile: string;
	includes: {
		database: boolean;
		uploads: boolean;
		plugins: boolean;
		themes: boolean;
	};
}

export interface BackupContents {
	backupFile: string;
	sqlFiles: string[];
	wpContent: {
		uploads: string[];
		plugins: string[];
		themes: string[];
	};
	wpConfigFile?: string;
}

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
