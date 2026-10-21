import { createExportErrorPayload, ExportEvents } from '@studio/common/lib/import-export-events';
import { dumpDatabase } from 'cli/lib/site-database/dump-load';
import { ImportExportEventEmitter } from '../../events';
import { ExportOptions, Exporter } from '../types';

export class SqlExporter extends ImportExportEventEmitter implements Exporter {
	constructor( private options: ExportOptions ) {
		super();
	}
	async export(): Promise< void > {
		this.emit( ExportEvents.EXPORT_START );
		try {
			await dumpDatabase( this.options.site, this.options.backupFile );
			this.emit( ExportEvents.EXPORT_COMPLETE );
		} catch ( error ) {
			this.emit( ExportEvents.EXPORT_ERROR, createExportErrorPayload( error ) );
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
