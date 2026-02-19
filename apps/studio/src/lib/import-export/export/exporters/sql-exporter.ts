import { EventEmitter } from 'events';
import { ExportEvents } from 'src/lib/import-export/export/events';
import { exportDatabaseToFile } from 'src/lib/import-export/export/export-database';
import { ExportOptions, Exporter } from 'src/lib/import-export/export/types';

export class SqlExporter extends EventEmitter implements Exporter {
	constructor( private options: ExportOptions ) {
		super();
	}
	async export(): Promise< void > {
		this.emit( ExportEvents.EXPORT_START );
		try {
			await exportDatabaseToFile( this.options.site, this.options.backupFile );
			this.emit( ExportEvents.EXPORT_COMPLETE );
		} catch ( error ) {
			this.emit( ExportEvents.EXPORT_ERROR );
			throw error;
		}
	}

	async canHandle(): Promise< boolean > {
		// Check for extension of the backup file to be sql.
		if ( ! this.options.backupFile.toLowerCase().endsWith( '.sql' ) ) {
			return false;
		}

		return this.options.includes.database;
	}
}
