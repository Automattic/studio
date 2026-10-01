import { BrowserWindow, IpcMainInvokeEvent } from 'electron';
import {
	createSnapshotManager,
	fetchSnapshots as fetchSnapshotsFromCli,
	deletePreviewSite as deletePreviewSiteViaCli,
	publishPreviewSite as publishPreviewSiteViaCli,
	renamePreviewSite as renamePreviewSiteViaCli,
	type SnapshotManager,
	type SnapshotOutput,
} from '@studio/common/sites/snapshots';
import { sendIpcEventToRendererWithWindow } from 'src/ipc-utils';
import { executeCliCommand } from 'src/modules/cli/lib/execute-command';
import type { Snapshot } from '@studio/common/types/snapshot';

// Desktop binding for the shared snapshot manager: forwards the CLI's progress
// to the originating renderer over the existing `snapshot-*` IPC channels. The
// `studio ui` server wires the same manager to SSE instead.
function snapshotManagerForWindow( window: BrowserWindow | null ): SnapshotManager {
	return createSnapshotManager( {
		executeCliCommand,
		emit: ( output: SnapshotOutput ) => {
			switch ( output.kind ) {
				case 'output':
					sendIpcEventToRendererWithWindow( window, 'snapshot-output', {
						operationId: output.operationId,
						data: output.data,
					} );
					break;
				case 'result':
					sendIpcEventToRendererWithWindow( window, 'snapshot-result', {
						operationId: output.operationId,
						data: output.data,
					} );
					break;
				case 'error':
					sendIpcEventToRendererWithWindow( window, 'snapshot-error', {
						operationId: output.operationId,
						data: output.data,
					} );
					break;
				case 'fatal-error':
					sendIpcEventToRendererWithWindow( window, 'snapshot-fatal-error', {
						operationId: output.operationId,
						data: output.data,
					} );
					break;
				case 'success':
					sendIpcEventToRendererWithWindow( window, 'snapshot-success', {
						operationId: output.operationId,
					} );
					break;
			}
		},
	} );
}

export async function fetchSnapshots(): Promise< Snapshot[] > {
	return fetchSnapshotsFromCli( executeCliCommand );
}

// For apps/ui: resolves with the preview's URL once it's published. Progress
// reaches the UI as sync activity, so nothing is forwarded on `snapshot-*`.
export async function publishPreviewSite(
	_event: IpcMainInvokeEvent,
	siteFolder: string,
	hostname?: string,
	name?: string
): Promise< { url: string } > {
	return publishPreviewSiteViaCli( executeCliCommand, siteFolder, hostname, name );
}

export async function deletePreviewSite( _event: IpcMainInvokeEvent, hostname: string ) {
	return deletePreviewSiteViaCli( executeCliCommand, hostname );
}

export async function renamePreviewSite(
	_event: IpcMainInvokeEvent,
	hostname: string,
	name: string
) {
	return renamePreviewSiteViaCli( executeCliCommand, hostname, name );
}

export async function createSnapshot(
	event: IpcMainInvokeEvent,
	siteFolder: string,
	name?: string
) {
	const window = BrowserWindow.fromWebContents( event.sender );
	return snapshotManagerForWindow( window ).createSnapshot( siteFolder, name );
}

export async function updateSnapshot(
	event: IpcMainInvokeEvent,
	siteFolder: string,
	hostname: string
) {
	const window = BrowserWindow.fromWebContents( event.sender );
	return snapshotManagerForWindow( window ).updateSnapshot( siteFolder, hostname );
}

export async function deleteSnapshot( event: IpcMainInvokeEvent, hostname: string ) {
	const window = BrowserWindow.fromWebContents( event.sender );
	return snapshotManagerForWindow( window ).deleteSnapshot( hostname );
}

export async function setSnapshot(
	event: IpcMainInvokeEvent,
	hostname: string,
	options: { name?: string }
) {
	const window = BrowserWindow.fromWebContents( event.sender );
	return snapshotManagerForWindow( window ).setSnapshot( hostname, options );
}

export async function deleteAllSnapshots() {
	return new Promise< void >( ( resolve, reject ) => {
		const [ cliEventEmitter ] = executeCliCommand( [ 'preview', 'delete', '--all' ], {
			output: 'capture',
			logPrefix: 'preview',
		} );
		cliEventEmitter.on( 'error', ( error ) => reject( error ) );
		cliEventEmitter.on( 'failure', ( error ) => reject( error ) );
		cliEventEmitter.on( 'success', () => resolve() );
	} );
}
