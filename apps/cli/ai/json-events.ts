import type { JsonEvent } from '@studio/common/ai/json-events';

export type { JsonEvent, TurnCompletedStatus } from '@studio/common/ai/json-events';

export function emitEvent( event: JsonEvent ): void {
	process.stdout.write( JSON.stringify( event ) + '\n' );
}
