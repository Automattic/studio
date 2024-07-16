import fsPromises from 'fs/promises';
import path from 'node:path';
<<<<<<< HEAD
import { DefaultExporter, SqlExporter } from './exporters';
import { ExportOptions, ExporterOption } from './types';
import { WordPressExportValidator } from './validators/wordpress-validator';
=======
import { ExportOptions } from './types';
>>>>>>> 33090046 (Update: Add export site function)

export async function exportBackup(
	exportOptions: ExportOptions,
	options: ExporterOption[] = defaultExporterOptions
): Promise< void > {
	const directoryContents = await fsPromises.readdir( exportOptions.sitePath, {
		recursive: true,
		withFileTypes: true,
	} );
<<<<<<< HEAD
	const allFiles = directoryContents.reduce< string[] >( ( files: string[], directoryContent ) => {
=======
	const allFiles = directoryContents.reduce( ( files: string[], directoryContent ) => {
>>>>>>> 33090046 (Update: Add export site function)
		if ( directoryContent.isFile() ) {
			files.push( path.join( directoryContent.path, directoryContent.name ) );
		}
		return files;
<<<<<<< HEAD
	}, [] );

	for ( const { validator, exporter } of options ) {
		if ( validator.canHandle( allFiles ) ) {
			const backupContents = validator.filterFiles( allFiles, exportOptions );
			const ExporterClass = exporter;
			const exporterInstance = new ExporterClass( backupContents );
			await exporterInstance.export( exportOptions );
			break;
		}
	}
=======
	}, [] as string[] );
	console.log( allFiles );
>>>>>>> 33090046 (Update: Add export site function)
}

export const defaultExporterOptions: ExporterOption[] = [
	{ validator: new WordPressExportValidator(), exporter: DefaultExporter },
	{ validator: new WordPressExportValidator(), exporter: SqlExporter },
];
