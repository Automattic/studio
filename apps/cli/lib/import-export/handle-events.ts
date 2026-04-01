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
	const removeListeners: ( () => void )[] = [];
	Object.values( events ).forEach( ( eventName ) => {
		const listener = ( data: unknown ) => {
			onEvent( {
				event: eventName as ImportExportEventType,
				data,
			} );
		};
		emitter.on?.( eventName, listener );
		removeListeners.push( () => emitter.off?.( eventName, listener ) );
	} );
	return () => {
		removeListeners.forEach( ( remove ) => remove() );
	};
};
