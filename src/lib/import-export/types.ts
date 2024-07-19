import { EventEmitter } from 'events';
import { ExportEventType } from './export/events';
import { ImportEventType } from './import/events';

export interface ImportExportEventData {
	event: ImportEventType | ExportEventType;
	data: unknown;
}

export const handleEvents = <
	T extends Record< string, string >,
	K extends ImportEventType | ExportEventType,
>(
	emitter: Partial< EventEmitter >,
	onEvent: ( data: ImportExportEventData ) => void,
	events: T
) => {
	Object.values( events ).forEach( ( eventName ) => {
		if ( ! emitter.on ) {
			return;
		}
		emitter.on( eventName, ( data: unknown ) => {
			onEvent( {
				event: eventName as K,
				data,
			} );
		} );
	} );
};
