import * as console from 'console';
import { EventEmitter } from 'events';
import { ExportEvents } from '../events';
import { ExportOptions, Exporter } from '../types';
import { getIpcApi } from '../../../get-ipc-api';

export class SqlExporter extends EventEmitter implements Exporter {
	constructor( private options: ExportOptions ) {
		super();
	}
	async export(): Promise< void > {
		this.emit( ExportEvents.EXPORT_START );
		console.log( `Database backup created at: ${ this.options.backupFile }` );
		console.log( 'Database backup options:', this.options );

		const { stdout, stderr } = await getIpcApi().executeWPCLiInline( {
			siteId: this.options.site.id,
			args: 'db export',
		} );
		if ( stderr ) {
			console.log( "ERROR", stderr );
		}

		console.log( stdout );


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
