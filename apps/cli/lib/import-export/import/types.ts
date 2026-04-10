import { Importer } from './importers/importer';

export interface MetaFileData {
	phpVersion?: string;
	wordpressVersion?: string;
	template?: string;
	stylesheet?: string;
	plugins?: string[];
}
export interface BackupContents {
	extractionDirectory: string;
	wpConfig: string;
	sqlFiles: string[];
	wpContentFiles: string[];
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
	processedFiles?: number;
	totalFiles?: number;
	currentFile?: string;
	extractedBytes?: number;
	totalBytes?: number;
}

export interface ImportDatabaseProgressEventData {
	currentTable?: string;
	processedTables?: number;
	totalTables?: number;
	currentFile?: string;
	processedFiles?: number;
	totalFiles?: number;
}

export interface ImportWpContentProgressEventData {
	type?: 'plugins' | 'themes' | 'uploads' | 'other';
	currentItem?: string;
	processedItems?: number;
	totalItems?: number;
	processedBytes?: number;
	totalBytes?: number;
}
