import { EventEmitter } from 'events';
import type { CheckpointEventTuple } from '@studio/common/lib/checkpoint-events';

type CheckpointEventType = CheckpointEventTuple[ 0 ];
type CheckpointEventData< T extends CheckpointEventType > = Extract<
	CheckpointEventTuple,
	[ T, unknown ]
>[ 1 ];

export type CheckpointEventListener< T extends CheckpointEventType > = (
	data: CheckpointEventData< T >
) => void;

export class CheckpointEventEmitter extends EventEmitter {
	on< T extends CheckpointEventType >(
		eventName: T,
		listener: CheckpointEventListener< T >
	): this {
		return super.on( eventName, listener );
	}

	off< T extends CheckpointEventType >(
		eventName: T,
		listener: CheckpointEventListener< T >
	): this {
		return super.off( eventName, listener );
	}

	emit< T extends CheckpointEventType >( eventName: T, data: CheckpointEventData< T > ): boolean {
		return super.emit( eventName, data );
	}
}
