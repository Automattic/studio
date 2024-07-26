import { EventEmitter } from 'events';
import { ExportEvents } from '../events';
import { BackupContents, ExportOptions, Exporter } from '../types';

export class SqlExporter extends EventEmitter implements Exporter {
	constructor( protected backup: BackupContents ) {
		super();
	}
	async export( options: ExportOptions ): Promise< void > {
		this.emit( ExportEvents.EXPORT_START );
		console.log( `Database backup created at: ${ options.backupFile }` );
		this.emit( ExportEvents.EXPORT_COMPLETE );
	}
}
