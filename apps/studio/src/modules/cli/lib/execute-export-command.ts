import {
	createExportErrorPayload,
	ExportEvents,
	exportIpcEventSchema,
} from '@studio/common/lib/import-export-events';
import { sendIpcEventToRendererWithWindow } from 'src/ipc-utils';
import { executeCliCommand } from 'src/modules/cli/lib/execute-command';
import { TypedEventEmitter } from 'src/modules/cli/lib/typed-event-emitter';

type ExportCliLifecycleEventMap = {
	completed: void;
	failed: { error: Error; displayError: unknown };
};
type ExportCliLifecycleEventEmitter = TypedEventEmitter< ExportCliLifecycleEventMap >;

export function executeExportCliCommand(
	siteId: string,
	args: string[],
	parentWindow: Electron.BrowserWindow | null,
	options: {
		abortSignal?: AbortSignal;
	} = {}
): ExportCliLifecycleEventEmitter {
	const [ cliEventEmitter, childProcess ] = executeCliCommand( args, {
		output: 'capture',
		logPrefix: siteId,
	} );
	const lifecycleEventEmitter = new TypedEventEmitter< ExportCliLifecycleEventMap >();
	let structuredExportError: unknown;
	let didEmitFinalLifecycleEvent = false;
	const { abortSignal } = options;

	function abortExportProcess() {
		childProcess.kill( 'SIGTERM' );
		emitFailure( new Error( 'Export aborted' ) );
	}

	function emitFailure( error: Error ) {
		if ( didEmitFinalLifecycleEvent ) {
			return;
		}
		didEmitFinalLifecycleEvent = true;
		abortSignal?.removeEventListener( 'abort', abortExportProcess );

		if ( structuredExportError === undefined ) {
			sendIpcEventToRendererWithWindow(
				parentWindow,
				'on-export',
				[ ExportEvents.EXPORT_ERROR, createExportErrorPayload( error ) ],
				siteId
			);
		}

		lifecycleEventEmitter.emit( 'failed', {
			error,
			displayError: structuredExportError ?? error,
		} );
	}

	if ( abortSignal ) {
		if ( abortSignal.aborted ) {
			queueMicrotask( abortExportProcess );
		} else {
			abortSignal.addEventListener( 'abort', abortExportProcess, { once: true } );
		}
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
		abortSignal?.removeEventListener( 'abort', abortExportProcess );
		lifecycleEventEmitter.emit( 'completed' );
	} );

	return lifecycleEventEmitter;
}
