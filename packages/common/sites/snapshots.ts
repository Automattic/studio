import crypto from 'node:crypto';
import { z } from 'zod';
import { PreviewCommandLoggerAction } from '@studio/common/logger-actions';
import { snapshotSchema, type Snapshot } from '@studio/common/types/snapshot';
import type { ExecuteCliCommand } from '@studio/common/lib/cli-process';

/**
 * Preview-site (snapshot) operations, delegated to the Studio CLI. Each
 * `preview` command is forked via the CLI and its progress relayed through the
 * injected `emit` callback.
 */

type OperationId = ReturnType< typeof crypto.randomUUID >;

// A progress/log line, or a final key/value (e.g. the preview `url`/`name`),
// matching what the CLI's Logger emits over its IPC channel.
export type SnapshotProgress = {
	action: PreviewCommandLoggerAction;
	status: 'inprogress' | 'fail' | 'success';
	message: string;
};
export type SnapshotKeyValue = { action: 'keyValuePair'; key: string; value: string };

// Everything a snapshot command produces for the UI, correlated by operationId.
export type SnapshotOutput =
	| { kind: 'output'; operationId: OperationId; data: SnapshotProgress }
	| { kind: 'key-value'; operationId: OperationId; data: SnapshotKeyValue }
	| { kind: 'error'; operationId: OperationId; data: SnapshotProgress }
	| { kind: 'fatal-error'; operationId: OperationId; data: { message: string } }
	| { kind: 'success'; operationId: OperationId };

const snapshotEventSchema = z.discriminatedUnion( 'action', [
	z.object( {
		action: z.enum( PreviewCommandLoggerAction ),
		status: z.enum( [ 'inprogress', 'fail', 'success' ] ),
		message: z.string(),
	} ),
	z.object( {
		action: z.literal( 'keyValuePair' ),
		key: z.string(),
		value: z.string(),
	} ),
] );

export interface SnapshotCommandContext {
	executeCliCommand: ExecuteCliCommand;
	emit: ( output: SnapshotOutput ) => void;
}

export interface SnapshotManager {
	createSnapshot( siteFolder: string, name?: string ): { operationId: OperationId };
	updateSnapshot( siteFolder: string, hostname: string ): { operationId: OperationId };
	deleteSnapshot( hostname: string ): { operationId: OperationId };
	setSnapshot( hostname: string, options: { name?: string } ): { operationId: OperationId };
}

export function createSnapshotManager( ctx: SnapshotCommandContext ): SnapshotManager {
	// Forks a `preview` subcommand, returns its operationId immediately, and
	// relays the CLI's progress/result through `emit`.
	function run( args: string[] ): { operationId: OperationId } {
		const operationId = crypto.randomUUID();
		const [ emitter ] = ctx.executeCliCommand( args, { output: 'capture' } );

		emitter.on( 'data', ( { data } ) => {
			const parsed = snapshotEventSchema.safeParse( data );
			if ( ! parsed.success ) {
				console.error( 'Invalid snapshot event:', parsed.error );
				return;
			}
			if ( parsed.data.action === 'keyValuePair' ) {
				ctx.emit( { kind: 'key-value', operationId, data: parsed.data } );
			} else if ( parsed.data.status === 'fail' ) {
				ctx.emit( { kind: 'error', operationId, data: parsed.data } );
			} else {
				ctx.emit( { kind: 'output', operationId, data: parsed.data } );
			}
		} );

		emitter.on( 'error', ( { error } ) =>
			ctx.emit( { kind: 'fatal-error', operationId, data: { message: error.message } } )
		);
		emitter.on( 'failure', ( { error } ) =>
			ctx.emit( { kind: 'fatal-error', operationId, data: { message: error.message } } )
		);
		emitter.on( 'success', () => ctx.emit( { kind: 'success', operationId } ) );

		return { operationId };
	}

	return {
		createSnapshot( siteFolder, name ) {
			const args = [ 'preview', 'create', '--path', siteFolder ];
			if ( name ) {
				args.push( '--name', name );
			}
			return run( args );
		},
		updateSnapshot( siteFolder, hostname ) {
			return run( [ 'preview', 'update', '--path', siteFolder, hostname ] );
		},
		deleteSnapshot( hostname ) {
			return run( [ 'preview', 'delete', hostname ] );
		},
		setSnapshot( hostname, options ) {
			const args = [ 'preview', 'set', hostname ];
			if ( options.name !== undefined ) {
				args.push( '--name', options.name );
			}
			return run( args );
		},
	};
}

// The CLI reports the snapshot list over its IPC channel as a `keyValuePair`
// ("snapshots" → JSON string), the same envelope the desktop reads.
const snapshotListKeyValueSchema = z.object( {
	action: z.literal( 'keyValuePair' ),
	key: z.literal( 'snapshots' ),
	value: z
		.string()
		.transform( ( val ) => JSON.parse( val ) as unknown )
		.pipe( z.array( snapshotSchema ) ),
} );

export async function fetchSnapshots(
	executeCliCommand: ExecuteCliCommand
): Promise< Snapshot[] > {
	try {
		return await new Promise< Snapshot[] >( ( resolve, reject ) => {
			const [ emitter ] = executeCliCommand( [ 'preview', 'list', '--format', 'json' ], {
				output: 'capture',
			} );
			emitter.on( 'data', ( { data } ) => {
				const parsed = snapshotListKeyValueSchema.safeParse( data );
				if ( parsed.success ) {
					resolve( parsed.data.value );
				}
			} );
			emitter.on( 'success', () => resolve( [] ) );
			emitter.on( 'failure', ( { error } ) => reject( error ) );
			emitter.on( 'error', ( { error } ) => reject( error ) );
		} );
	} catch ( error ) {
		console.error( 'Failed to fetch snapshots from CLI:', error );
		return [];
	}
}
