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

// Let's use the importer types when merged
export interface BackupContents {
	extractionDirectory: string;
	sqlFiles: string[];
	wpContent: {
		uploads: string[];
		plugins: string[];
		themes: string[];
	};
	wpConfigFile?: string;
}

export interface ExportValidator {
	canHandle( files: string[] ): boolean;
	filterFiles( files: string[], options: ExportOptions ): BackupContents;
}

export interface Exporter {
	canHandle( options: ExportOptions ): boolean;
	export(
		backupContents: BackupContents,
		options: ExportOptions,
		progressCallback: ( progress: number ) => void
	): Promise< void >;
}

export interface ExporterOption {
	validator: ExportValidator;
	exporter: new () => Exporter;
}
