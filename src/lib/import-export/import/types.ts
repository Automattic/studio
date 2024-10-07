import { Importer } from './importers';

export interface MetaFileData {
	phpVersion?: string;
	wordpressVersion?: string;
	template?: string;
	stylesheet?: string;
	plugins?: string[];
}

export interface WpContent {
	uploads: string[];
	plugins: string[];
	themes: string[];
}

export interface BackupContents {
	extractionDirectory: string;
	wpConfig: string;
	sqlFiles: string[];
	wpContent: WpContent;
	wpContentDirectory: string;
	metaFile?: string;
}

export interface BackupArchiveInfo {
	path: string;
	type: string;
}

export type NewImporter = new ( backup: BackupContents ) => Importer;

export interface BackupExtractProgressEventData {
	progress: number;
}
