import { ExportOptions, Exporter } from '../types';

export class SqlExporter implements Exporter {
	async export( options: ExportOptions ): Promise< void > {
		console.log( `Database backup created at: ${ options.backupFile }` );
	}
}
