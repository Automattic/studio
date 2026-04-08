import { BrowserWindow, IpcMainInvokeEvent } from 'electron';
import { snapshotSchema } from '@studio/common/types/snapshot';
import { z } from 'zod';
import { executeCliCommand } from 'src/modules/cli/lib/execute-command';
import { executePreviewCliCommand } from 'src/modules/cli/lib/execute-preview-command';
import type { Snapshot } from '@studio/common/types/snapshot';

const snapshotListKeyValueSchema = z.object( {
	action: z.literal( 'keyValuePair' ),
	key: z.literal( 'snapshots' ),
	value: z
		.string()
		.transform( ( val ) => JSON.parse( val ) )
		.pipe( z.array( snapshotSchema ) ),
} );

export async function fetchSnapshots(): Promise< Snapshot[] > {
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

export async function createSnapshot(
	event: IpcMainInvokeEvent,
	siteFolder: string,
	name?: string
) {
	const parentWindow = BrowserWindow.fromWebContents( event.sender );
	const args = [ 'preview', 'create', '--path', siteFolder ];
	if ( name ) {
		args.push( '--name', name );
	}
	return executePreviewCliCommand( args, parentWindow );
}

export async function updateSnapshot(
	event: IpcMainInvokeEvent,
	siteFolder: string,
	hostname: string
) {
	const parentWindow = BrowserWindow.fromWebContents( event.sender );
	return executePreviewCliCommand(
		[ 'preview', 'update', '--path', siteFolder, hostname ],
		parentWindow
	);
}

export async function deleteSnapshot( event: IpcMainInvokeEvent, hostname: string ) {
	const parentWindow = BrowserWindow.fromWebContents( event.sender );
	return executePreviewCliCommand( [ 'preview', 'delete', hostname ], parentWindow );
}

export async function deleteAllSnapshots() {
	return new Promise< void >( ( resolve, reject ) => {
		const [ cliEventEmitter ] = executeCliCommand( [ 'preview', 'delete', '--all' ] );
		cliEventEmitter.on( 'error', ( error ) => reject( error ) );
		cliEventEmitter.on( 'failure', ( error ) => reject( error ) );
		cliEventEmitter.on( 'success', () => resolve() );
	} );
}

export async function setSnapshot(
	event: IpcMainInvokeEvent,
	hostname: string,
	options: { name?: string }
) {
	const parentWindow = BrowserWindow.fromWebContents( event.sender );
	const args = [ 'preview', 'set', hostname ];
	if ( options.name !== undefined ) {
		args.push( '--name', options.name );
	}
	return executePreviewCliCommand( args, parentWindow );
}
