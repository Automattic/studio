import { EventEmitter } from 'events';

export interface ExportOptions {
	sitePath: string;
	siteId?: string;
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

export interface Exporter extends Partial< EventEmitter > {
	canHandle(): Promise< boolean >;
	export(): Promise< void >;
}

export type NewExporter = new ( options: ExportOptions ) => Exporter;
