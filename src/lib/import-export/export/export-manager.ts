import { ImportExportEventData, handleEvents } from '../handle-events';
import { ExportEvents } from './events';
import { DefaultExporter, SqlExporter } from './exporters';
import { ExportOptions, NewExporter } from './types';

export async function exportBackup(
	exportOptions: ExportOptions,
	onEvent: ( data: ImportExportEventData ) => void,
	exporters: NewExporter[] = defaultExporterOptions
): Promise< void > {
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
		throw new Error( 'No suitable exporter found for the site' );
	}
}

export const defaultExporterOptions: NewExporter[] = [ DefaultExporter, SqlExporter ];
