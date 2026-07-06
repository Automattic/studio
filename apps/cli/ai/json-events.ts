import type { JsonEvent } from '@studio/common/ai/json-events';

export {
	type AgentMessageJsonEvent,
	type JsonEvent,
	type TurnCompletedStatus,
} from '@studio/common/ai/json-events';

export function emitEvent( event: JsonEvent ): void {
	// When forked from the Studio main process the Node IPC channel is
	// available; prefer it so events arrive as structured objects without a
	// stringify/parse round-trip. For standalone CLI use (e.g. piping `studio
	// code sessions resume … --json` in a shell) `process.send` is undefined
	// and we fall back to NDJSON on stdout — the public contract is unchanged.
	if ( typeof process.send === 'function' ) {
		process.send( event );
		return;
	}
	process.stdout.write( JSON.stringify( event ) + '\n' );
}
