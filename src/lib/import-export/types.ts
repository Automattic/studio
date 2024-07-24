import { EventEmitter } from 'events';
import { ExportEventType } from './export/events';
import { ImportEventType } from './import/events';

export type ImportExportEventType = ImportEventType | ExportEventType;

export interface ImportExportEventData {
	event: ImportExportEventType;
	data: unknown;
}

export const handleEvents = (
	emitter: Partial< EventEmitter >,
	onEvent: ( data: ImportExportEventData ) => void,
	events: Record< string, string >
) => {
	Object.values( events ).forEach( ( eventName ) => {
		if ( ! emitter.on ) {
			return;
		}
		emitter.on( eventName, ( data: unknown ) => {
			onEvent( {
				event: eventName as ImportExportEventType,
				data,
			} );
		} );
	} );
};
