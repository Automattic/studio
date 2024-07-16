import { Importer } from "./importers";

export interface MetaFileData {
	phpVersion: string;
	wordpressVersion: string;
}

export interface WpContent {
	uploads: string[];
	plugins: string[];
	themes: string[];
}

export interface BackupContents {
	extractionDirectory: string;
	sqlFiles: string[];
	wpContent: WpContent;
	metaFile?: string;
}

export interface BackupArchiveInfo {
	path: string;
	type: string;
}

export type NewImporter = new ( backup: BackupContents ) => Importer
