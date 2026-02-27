import { ExportEvents } from 'src/lib/import-export/export/events';
import { DefaultExporter, SqlExporter } from 'src/lib/import-export/export/exporters';
import { ExportOptions, NewExporter } from 'src/lib/import-export/export/types';
import { ImportExportEventData, handleEvents } from 'src/lib/import-export/handle-events';

export async function exportBackup(
	exportOptions: ExportOptions,
	onEvent: ( data: ImportExportEventData ) => void,
	exporters: NewExporter[] = defaultExporterOptions
): Promise< boolean > {
	let foundValidExporter;
	for ( const Exporter of exporters ) {
		const exporterInstance = new Exporter( exportOptions );
		const removeExportListeners = handleEvents( exporterInstance, onEvent, ExportEvents );
		foundValidExporter = await exporterInstance.canHandle();
		if ( foundValidExporter ) {
			try {
				await exporterInstance.export();
			} finally {
				removeExportListeners();
			}
			break;
		}
	}
	if ( ! foundValidExporter ) {
		onEvent( { event: ExportEvents.EXPORT_ERROR, data: null } );
		return false;
	}
	return true;
}

const defaultExporterOptions: NewExporter[] = [ DefaultExporter, SqlExporter ];
