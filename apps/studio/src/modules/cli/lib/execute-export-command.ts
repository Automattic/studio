import { ExportEvents, exportIpcEventSchema } from '@studio/common/lib/import-export-events';
import { TypedEventEmitter } from '@studio/common/lib/typed-event-emitter';
import { executeCliCommand } from 'src/modules/cli/lib/execute-command';

type ExportCliLifecycleEventMap = {
	completed: void;
	failed: { error: Error; displayError: unknown };
};
type ExportCliLifecycleEventEmitter = TypedEventEmitter< ExportCliLifecycleEventMap >;

export function executeExportCliCommand(
	siteId: string,
	args: string[],
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
