// Typed event tuples for checkpoint create/restore progress, mirroring the
// import/export event pattern in `import-export-events.ts`. Events are emitted
// by the CLI and forwarded over IPC (`process.send`) when the CLI runs as a
// child of the desktop app or the local server.

export enum CheckpointEvents {
	CHECKPOINT_CREATE_START = 'checkpoint_create_start',
	CHECKPOINT_CREATE_PROGRESS = 'checkpoint_create_progress',
	CHECKPOINT_CREATE_COMPLETE = 'checkpoint_create_complete',
	CHECKPOINT_CREATE_ERROR = 'checkpoint_create_error',
	CHECKPOINT_RESTORE_START = 'checkpoint_restore_start',
	CHECKPOINT_RESTORE_PROGRESS = 'checkpoint_restore_progress',
	CHECKPOINT_RESTORE_COMPLETE = 'checkpoint_restore_complete',
	CHECKPOINT_RESTORE_ERROR = 'checkpoint_restore_error',
}

// Phases progress through in order. `database` covers DB capture/restore,
// `files` covers walking/hashing/applying the site tree.
export type CheckpointProgressPhase = 'database' | 'files' | 'finalizing';

export interface CheckpointProgressPayload {
	phase: CheckpointProgressPhase;
	// Files processed so far and the total when known. Totals are unknown
	// during the first walk of a site, so consumers must tolerate `undefined`.
	processed?: number;
	total?: number;
}

export interface CheckpointErrorPayload {
	message: string;
}

export interface CheckpointCompletePayload {
	checkpointId: string;
	siteId: string;
}

export type CheckpointEventTuple =
	| [ CheckpointEvents.CHECKPOINT_CREATE_START, { siteId: string } ]
	| [ CheckpointEvents.CHECKPOINT_CREATE_PROGRESS, CheckpointProgressPayload ]
	| [ CheckpointEvents.CHECKPOINT_CREATE_COMPLETE, CheckpointCompletePayload ]
	| [ CheckpointEvents.CHECKPOINT_CREATE_ERROR, CheckpointErrorPayload ]
	| [ CheckpointEvents.CHECKPOINT_RESTORE_START, { siteId: string; checkpointId: string } ]
	| [ CheckpointEvents.CHECKPOINT_RESTORE_PROGRESS, CheckpointProgressPayload ]
	| [ CheckpointEvents.CHECKPOINT_RESTORE_COMPLETE, CheckpointCompletePayload ]
	| [ CheckpointEvents.CHECKPOINT_RESTORE_ERROR, CheckpointErrorPayload ];

export interface CheckpointIpcEvent {
	checkpointEvent: CheckpointEventTuple;
}

export function createCheckpointErrorPayload( error: unknown ): CheckpointErrorPayload {
	return { message: error instanceof Error ? error.message : String( error ) };
}
