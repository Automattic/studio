import { EventEmitter } from 'events';
import type {
	ImportExportEventType,
	ImportExportEventDataMap,
} from '@studio/common/lib/import-export-events';

export type ImportExportEventListener< T extends ImportExportEventType > =
	undefined extends ImportExportEventDataMap[ T ]
		? ( data?: ImportExportEventDataMap[ T ] ) => void
		: ( data: ImportExportEventDataMap[ T ] ) => void;

type ImportExportEventEmitArgs< T extends ImportExportEventType > =
	undefined extends ImportExportEventDataMap[ T ]
		? [ data?: ImportExportEventDataMap[ T ] ]
		: [ data: ImportExportEventDataMap[ T ] ];

export class ImportExportEventEmitter extends EventEmitter {
	on< T extends ImportExportEventType >(
		eventName: T,
		listener: ImportExportEventListener< T >
	): this;
	on( eventName: string | symbol, listener: ( ...args: unknown[] ) => void ): this {
		return super.on( eventName, listener );
	}

	off< T extends ImportExportEventType >(
		eventName: T,
		listener: ImportExportEventListener< T >
	): this;
	off( eventName: string | symbol, listener: ( ...args: unknown[] ) => void ): this {
		return super.off( eventName, listener );
	}

	emit< T extends ImportExportEventType >(
		eventName: T,
		...args: ImportExportEventEmitArgs< T >
	): boolean;
	emit( eventName: string | symbol, ...args: unknown[] ): boolean {
		return super.emit( eventName, ...args );
	}
}
