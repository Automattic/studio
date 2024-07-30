import * as console from 'console';
import { EventEmitter } from 'events';
import { SiteServer } from '../../../../site-server';
import { ExportEvents } from '../events';
import { ExportOptions, Exporter } from '../types';

export class SqlExporter extends EventEmitter implements Exporter {
	constructor( private options: ExportOptions ) {
		super();
	}
	async export(): Promise< void > {
		this.emit( ExportEvents.EXPORT_START );
		console.log( `Database backup created at: ${ this.options.backupFile }` );
		console.log( 'Database backup options:', this.options );

		const server = SiteServer.get( this.options.site.id );

		if ( ! server ) {
			throw new Error( 'Site not found.' );
		}

		const { stdout, stderr } = await server.executeWpCliCommand( 'db export' );

		if ( stderr ) {
			console.log( 'ERROR db export', stderr );
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
