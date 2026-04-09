import { SiteData } from 'cli/lib/cli-config/core';
import type { ProgressData } from 'archiver';
import type { EventEmitter } from 'events';

export interface ExportOptions {
	site: SiteData;
	backupFile: string;
	includes: { [ index in ExportOptionsIncludes ]: boolean };
	phpVersion: string;
	splitDatabaseDumpByTable?: boolean;
	specificSelectionPaths?: string[];
}

export type ExportOptionsIncludes = 'wpContent' | 'database';

export interface BackupContents {
	backupFile: string;
	sqlFiles: string[];
}

export interface Exporter extends Partial< EventEmitter > {
	canHandle(): Promise< boolean >;
	export(): Promise< void >;
}

export interface BackupCreateProgressEventData {
	progress: ProgressData;
}

export type NewExporter = new ( options: ExportOptions ) => Exporter;

export interface StudioJson {
	phpVersion: string;
	wordpressVersion?: string;
	siteUrl: string;
	plugins: StudioJsonPluginOrTheme[];
	themes: StudioJsonPluginOrTheme[];
}

export interface StudioJsonPluginOrTheme {
	name: string;
	status: 'active' | 'inactive';
	version: string;
}
