import {
	ImporterEvents,
	ImporterType,
	importIpcEventSchema,
} from '@studio/common/lib/import-export-events';
import { sendIpcEventToRendererWithWindow } from 'src/ipc-utils';
import { executeCliCommand } from 'src/modules/cli/lib/execute-command';
import { TypedEventEmitter } from 'src/modules/cli/lib/typed-event-emitter';

type ImportCliLifecycleEventMap = {
	completed: { importerType?: ImporterType };
	failed: { error: Error; displayError: unknown };
};
type ImportCliLifecycleEventEmitter = TypedEventEmitter< ImportCliLifecycleEventMap >;

export function executeImportCliCommand(
	siteId: string,
	args: string[],
	parentWindow: Electron.BrowserWindow | null
): ImportCliLifecycleEventEmitter {
	const logImportDebug = ( ...messages: unknown[] ) => {
		console.log( '[IMPORT DEBUG][executeImportCliCommand]', ...messages );
	};
	logImportDebug( 'initializing lifecycle bridge', { siteId, args } );

	const [ cliEventEmitter ] = executeCliCommand( args, { output: 'capture' } );
	const lifecycleEventEmitter = new TypedEventEmitter< ImportCliLifecycleEventMap >();
	let importerType: ImporterType | undefined;
	let structuredImportError: unknown;
	let didEmitFinalLifecycleEvent = false;

	function emitFailure( error: Error ) {
		logImportDebug( 'emitFailure called', {
			didEmitFinalLifecycleEvent,
			errorName: error.name,
			errorMessage: error.message,
			hasStructuredImportError: structuredImportError !== undefined,
		} );
		if ( didEmitFinalLifecycleEvent ) {
			logImportDebug( 'skipping failure emit because terminal event already emitted' );
			return;
		}
		didEmitFinalLifecycleEvent = true;

		if ( structuredImportError === undefined ) {
			logImportDebug(
				'structured import error missing; sending synthetic IMPORT_ERROR to renderer'
			);
			logImportDebug( 'sending IPC event to renderer', {
				channel: 'on-import',
				event: ImporterEvents.IMPORT_ERROR,
				siteId,
				parentWindowAvailable: !! parentWindow && ! parentWindow.isDestroyed(),
			} );
			sendIpcEventToRendererWithWindow(
				parentWindow,
				'on-import',
				[ ImporterEvents.IMPORT_ERROR, error ],
				siteId
			);
		}

		logImportDebug( 'emitting failed lifecycle event' );
		lifecycleEventEmitter.emit( 'failed', {
			error,
			displayError: structuredImportError ?? error,
		} );
	}

	cliEventEmitter.on( 'data', ( { data } ) => {
		const parsed = importIpcEventSchema.safeParse( data );

		if ( parsed.success ) {
			logImportDebug( 'parsed import IPC event', {
				event: parsed.data.event[ 0 ],
			} );
			logImportDebug( 'sending IPC event to renderer', {
				channel: 'on-import',
				event: parsed.data.event[ 0 ],
				siteId,
				parentWindowAvailable: !! parentWindow && ! parentWindow.isDestroyed(),
			} );
			sendIpcEventToRendererWithWindow( parentWindow, 'on-import', parsed.data.event, siteId );

			if ( parsed.data.event[ 0 ] === ImporterEvents.IMPORT_COMPLETE ) {
				importerType = parsed.data.event[ 1 ];
			}

			if ( parsed.data.event[ 0 ] === ImporterEvents.IMPORT_ERROR ) {
				logImportDebug( 'captured structured import error from IPC event' );
				structuredImportError = parsed.data.event[ 1 ];
			}
		} else {
			logImportDebug( 'ignored non-import IPC payload', {
				payloadType: typeof data,
			} );
		}
	} );

	cliEventEmitter.on( 'error', ( { error } ) => {
		logImportDebug( 'received cliEventEmitter error event', {
			errorName: error.name,
			errorMessage: error.message,
		} );
		emitFailure( error );
	} );

	cliEventEmitter.on( 'failure', ( { error } ) => {
		logImportDebug( 'received cliEventEmitter failure event', {
			errorName: error.name,
			errorMessage: error.message,
		} );
		emitFailure( error );
	} );

	cliEventEmitter.on( 'success', () => {
		logImportDebug( 'received cliEventEmitter success event', {
			didEmitFinalLifecycleEvent,
			importerType,
		} );
		if ( didEmitFinalLifecycleEvent ) {
			logImportDebug( 'skipping completed emit because terminal event already emitted' );
			return;
		}
		didEmitFinalLifecycleEvent = true;
		logImportDebug( 'emitting completed lifecycle event', { importerType } );
		lifecycleEventEmitter.emit( 'completed', {
			importerType,
		} );
	} );

	return lifecycleEventEmitter;
}
