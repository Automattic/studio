import { DefaultExporter, SqlExporter } from './exporters';
import { ExportOptions, Exporter, NewExporter } from './types';

export async function getExporter(
	exportOptions: ExportOptions,
	exporters: NewExporter[] = defaultExporterOptions
): Promise< Exporter | null > {
	for ( const Exporter of exporters ) {
		const exporterInstance = new Exporter( exportOptions );
		if ( await exporterInstance.canHandle() ) {
			return exporterInstance;
		}
	}
	return null;
}

const defaultExporterOptions: NewExporter[] = [ DefaultExporter, SqlExporter ];
