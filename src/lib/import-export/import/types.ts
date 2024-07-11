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

export interface DbConfig {
	host: string;
	user: string;
	password: string;
	database: string;
}
