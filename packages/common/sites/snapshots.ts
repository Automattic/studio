import crypto from 'node:crypto';
import { z } from 'zod';
import { runCliCommand, type ExecuteCliCommand } from '@studio/common/lib/cli-process';
import { PreviewCommandLoggerAction } from '@studio/common/logger-actions';
import { snapshotSchema, type Snapshot } from '@studio/common/types/snapshot';

/**
 * Preview-site (snapshot) operations, delegated to the Studio CLI. Each
 * `preview` command is forked via the CLI and its progress relayed through the
 * injected `emit` callback.
 */

type OperationId = ReturnType< typeof crypto.randomUUID >;

// A progress/log line, matching what the CLI's Logger emits over its IPC channel.
export type SnapshotProgress = {
	action: PreviewCommandLoggerAction;
	status: 'inprogress' | 'fail' | 'success';
	message: string;
};

// What `preview create` and `preview update` report as their result.
const previewResultSchema = z.object( { name: z.string().optional(), url: z.string() } );
export type PreviewResult = z.infer< typeof previewResultSchema >;

// Everything a snapshot command produces for the UI, correlated by operationId.
export type SnapshotOutput =
	| { kind: 'output'; operationId: OperationId; data: SnapshotProgress }
	| { kind: 'result'; operationId: OperationId; data: PreviewResult }
	| { kind: 'error'; operationId: OperationId; data: SnapshotProgress }
	| { kind: 'fatal-error'; operationId: OperationId; data: { message: string } }
	| { kind: 'success'; operationId: OperationId };

const snapshotEventSchema = z.discriminatedUnion( 'action', [
	z.object( {
		action: z.enum( PreviewCommandLoggerAction ),
		status: z.enum( [ 'inprogress', 'fail', 'success' ] ),
		message: z.string(),
	} ),
	z.object( { action: z.literal( 'result' ), value: previewResultSchema } ),
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
		const [ emitter ] = ctx.executeCliCommand( args, { output: 'capture', logPrefix: 'preview' } );

		emitter.on( 'data', ( { data } ) => {
			const parsed = snapshotEventSchema.safeParse( data );
			if ( ! parsed.success ) {
				console.error( 'Invalid snapshot event:', parsed.error );
				return;
			}
			if ( parsed.data.action === 'result' ) {
				ctx.emit( { kind: 'result', operationId, data: parsed.data.value } );
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

/**
 * Creates a preview site (named `name`, when given), or refreshes the one at `hostname`, and
 * resolves with its URL once the CLI command finishes. The command publishes its progress as sync
 * activity.
 */
export async function publishPreviewSite(
	executeCliCommand: ExecuteCliCommand,
	siteFolder: string,
	hostname?: string,
	name?: string
): Promise< { url: string } > {
	const { url } = await runCliCommand(
		executeCliCommand,
		hostname
			? [ 'preview', 'update', '--path', siteFolder, hostname ]
			: [ 'preview', 'create', '--path', siteFolder, ...( name ? [ '--name', name ] : [] ) ],
		previewResultSchema,
		{ logPrefix: 'preview' }
	);
	return { url };
}

export async function deletePreviewSite(
	executeCliCommand: ExecuteCliCommand,
	hostname: string
): Promise< void > {
	await runCliCommand( executeCliCommand, [ 'preview', 'delete', hostname ], previewResultSchema, {
		logPrefix: 'preview',
	} );
}

export async function renamePreviewSite(
	executeCliCommand: ExecuteCliCommand,
	hostname: string,
	name: string
): Promise< void > {
	await runCliCommand(
		executeCliCommand,
		[ 'preview', 'set', hostname, '--name', name ],
		previewResultSchema,
		{ logPrefix: 'preview' }
	);
}

export async function fetchSnapshots(
	executeCliCommand: ExecuteCliCommand
): Promise< Snapshot[] > {
	try {
		return await runCliCommand(
			executeCliCommand,
			[ 'preview', 'list', '--format', 'json' ],
			z.array( snapshotSchema )
		);
	} catch ( error ) {
		console.error( 'Failed to fetch snapshots from CLI:', error );
		return [];
	}
}
