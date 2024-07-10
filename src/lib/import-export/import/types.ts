export interface BackupContents {
	extractedPath: string;
	sqlFiles: string[];
	wpContent: {
		[ key: string ]: string[]; // 'uploads', 'plugins', 'themes'
	};
	metaFile?: string;
}

export interface FileInput {
	path: string;
	type: string;
}

export interface DbConfig {
	host: string;
	user: string;
	password: string;
	database: string;
}
