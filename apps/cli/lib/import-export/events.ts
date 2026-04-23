import { EventEmitter } from 'events';
import type { ImportEventTuple, ExportEventTuple } from '@studio/common/lib/import-export-events';

type ImportExportEventTuple = ImportEventTuple | ExportEventTuple;
type ImportExportEventType = ImportExportEventTuple[ 0 ];
type ImportExportEventData< T extends ImportExportEventType > = Extract<
	ImportExportEventTuple,
	[ T, unknown ]
>[ 1 ];

export type ImportExportEventListener< T extends ImportExportEventType > =
	undefined extends ImportExportEventData< T >
		? ( data?: ImportExportEventData< T > ) => void
		: ( data: ImportExportEventData< T > ) => void;

type ImportExportEventEmitArgs< T extends ImportExportEventType > =
	undefined extends ImportExportEventData< T >
		? [ data?: ImportExportEventData< T > ]
		: [ data: ImportExportEventData< T > ];

export class ImportExportEventEmitter extends EventEmitter {
	on< T extends ImportExportEventType >(
		eventName: T,
		listener: ImportExportEventListener< T >
	): this {
		return super.on( eventName, listener );
	}

	off< T extends ImportExportEventType >(
		eventName: T,
		listener: ImportExportEventListener< T >
	): this {
		return super.off( eventName, listener );
	}

	emit< T extends ImportExportEventType >(
		eventName: T,
		...args: ImportExportEventEmitArgs< T >
	): boolean {
		return super.emit( eventName, ...args );
	}
}
