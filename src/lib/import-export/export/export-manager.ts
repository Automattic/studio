import fsPromises from 'fs/promises';
import path from 'node:path';
import { JetpackExporter, SqlExporter } from './exporters';
import { ExportOptions, ExporterOption } from './types';
import { WordPressExportValidator } from './validators/wordpress-validator';

export async function exportBackup(
	exportOptions: ExportOptions,
	options: ExporterOption[] = defaultExporterOptions
): Promise< void > {
	const directoryContents = await fsPromises.readdir( exportOptions.sitePath, {
		recursive: true,
		withFileTypes: true,
	} );
	const allFiles = directoryContents.reduce( ( files: string[], directoryContent ) => {
		if ( directoryContent.isFile() ) {
			files.push( path.join( directoryContent.path, directoryContent.name ) );
		}
		return files;
	}, [] as string[] );

	for ( const { validator, exporter } of options ) {
		if ( validator.canHandle( allFiles ) ) {
			const backupContents = validator.filterFiles( allFiles, exportOptions );
			const ExporterClass = exporter;
			const exporterInstance = new ExporterClass( backupContents );
			await exporterInstance.export( exportOptions );
			break;
		}
	}
}

export const defaultExporterOptions: ExporterOption[] = [
	{ validator: new WordPressExportValidator(), exporter: JetpackExporter },
	{ validator: new WordPressExportValidator(), exporter: SqlExporter },
];
