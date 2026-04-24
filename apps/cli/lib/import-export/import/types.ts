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
