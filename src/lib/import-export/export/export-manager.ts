import { ImportExportEventData, handleEvents } from '../types';
import { ExporterEvents } from './events';
import { DefaultExporter, SqlExporter } from './exporters';
import { ExportOptions, NewExporter } from './types';

export async function exportBackup(
	exportOptions: ExportOptions,
	onEvent: ( data: ImportExportEventData ) => void,
	exporters: NewExporter[] = defaultExporterOptions
): Promise< void > {
	for ( const Exporter of exporters ) {
		const exporter = new Exporter( exportOptions );
		if ( await exporter.canHandle() ) {
			const removeExportListeners = handleEvents( exporter, onEvent, ExporterEvents );
			try {
				await exporter.export();
			} finally {
				removeExportListeners();
			}
			handleEvents( exporter, onEvent, ExporterEvents );
			break;
		}
	}
}

export const defaultExporterOptions: NewExporter[] = [ DefaultExporter, SqlExporter ];
