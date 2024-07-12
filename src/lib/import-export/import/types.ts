export interface MetaFileData {
	phpVersion: string;
	wordpressVersion: string;
}
export interface BackupContents {
	extractionDirectory: string;
	sqlFiles: string[];
	wpContent: {
		[ key: string ]: string[]; // 'uploads', 'plugins', 'themes'
	};
	metaFile?: string;
}

export interface BackupArchiveInfo {
	path: string;
	type: string;
}
