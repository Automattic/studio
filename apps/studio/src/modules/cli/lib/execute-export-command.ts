import { ExportEvents, exportIpcEventSchema } from '@studio/common/lib/import-export-events';
import { sendIpcEventToRendererWithWindow } from 'src/ipc-utils';
import { executeCliCommand } from 'src/modules/cli/lib/execute-command';
import { TypedEventEmitter } from 'src/modules/cli/lib/typed-event-emitter';

type ExportCliLifecycleEventMap = {
	completed: void;
	failed: { error: Error; displayError: unknown };
};
type ExportCliLifecycleEventEmitter = TypedEventEmitter< ExportCliLifecycleEventMap >;

export async function executeExportCliCommand(
	siteId: string,
	args: string[],
	parentWindow: Electron.BrowserWindow | null
): Promise< ExportCliLifecycleEventEmitter > {
	const [ cliEventEmitter ] = executeCliCommand( args, { output: 'capture' } );
	const lifecycleEventEmitter = new TypedEventEmitter< ExportCliLifecycleEventMap >();
	let structuredExportError: unknown;
	let didEmitFinalLifecycleEvent = false;

	function emitFailure( error: Error ) {
		if ( didEmitFinalLifecycleEvent ) {
			return;
		}
		didEmitFinalLifecycleEvent = true;

		if ( structuredExportError === undefined ) {
			sendIpcEventToRendererWithWindow(
				parentWindow,
				'on-export',
				[ ExportEvents.EXPORT_ERROR, error ],
				siteId
			);
		}

		lifecycleEventEmitter.emit( 'failed', {
			error,
			displayError: structuredExportError ?? error,
		} );
	}

	cliEventEmitter.on( 'data', ( { data } ) => {
		const parsed = exportIpcEventSchema.safeParse( data );

		if ( parsed.success ) {
			sendIpcEventToRendererWithWindow( parentWindow, 'on-export', parsed.data.event, siteId );

			if ( parsed.data.event[ 0 ] === ExportEvents.EXPORT_ERROR ) {
				structuredExportError = parsed.data.event[ 1 ];
			}
		}
	} );

	cliEventEmitter.on( 'error', ( { error } ) => {
		emitFailure( error );
	} );

	cliEventEmitter.on( 'failure', ( { error } ) => {
		emitFailure( error );
	} );

	cliEventEmitter.on( 'success', () => {
		if ( didEmitFinalLifecycleEvent ) {
			return;
		}
		didEmitFinalLifecycleEvent = true;
		lifecycleEventEmitter.emit( 'completed' );
	} );

	return lifecycleEventEmitter;
}
