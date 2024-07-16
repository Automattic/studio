export interface ExportOptions {
	sitePath: string;
	backupPath: string;
	includes: {
		database: boolean;
		uploads: boolean;
		plugins: boolean;
		themes: boolean;
	};
}
