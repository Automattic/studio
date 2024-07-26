import * as console from 'console';
import { ExportOptions, Exporter } from '../types';
import { EventEmitter } from 'events';
import { ExportEvents } from '../events';

export class SqlExporter extends EventEmitter implements Exporter  {
	constructor( private options: ExportOptions ) {
		super();
	}
	async export(): Promise< void > {
		this.emit( ExportEvents.EXPORT_START );
		console.log( `Database backup created at: ${ this.options.backupFile }` );
		console.log( 'Database backup options:', this.options );
		this.emit( ExportEvents.EXPORT_COMPLETE );
	}

	async canHandle(): Promise< boolean > {
		// Check for extension of the backup file to be sql.
		if ( ! this.options.backupFile.toLowerCase().endsWith( '.sql' ) ) {
			return false;
		}

		return this.options.includes.database;
	}
}
