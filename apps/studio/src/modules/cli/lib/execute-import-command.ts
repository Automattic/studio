import {
	BackupExtractEvents,
	ImporterEvents,
	ImporterType,
	importIpcEventSchema,
	ValidatorEvents,
} from '@studio/common/lib/import-export-events';
import { z } from 'zod';
import { sendIpcEventToRendererWithWindow } from 'src/ipc-utils';
import { executeCliCommand } from 'src/modules/cli/lib/execute-command';
import { TypedEventEmitter } from 'src/modules/cli/lib/typed-event-emitter';

type ImportCliLifecycleEventMap = {
	completed: { importerType?: ImporterType };
	failed: { error: Error; displayError: unknown };
};
type ImportCliLifecycleEventEmitter = TypedEventEmitter< ImportCliLifecycleEventMap >;

const errorMessageSchema = z.object( { message: z.string() } );

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

	function ensureError( error: unknown, fallbackMessage: string ): Error {
		if ( error instanceof Error ) {
			return error;
		}

		if ( typeof error === 'string' ) {
			return new Error( error );
		}

		const parsedErrorMessage = errorMessageSchema.safeParse( error );
		if ( parsedErrorMessage.success && parsedErrorMessage.data.message ) {
			return new Error( parsedErrorMessage.data.message );
		}

		return new Error( fallbackMessage );
	}

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
			const eventName = parsed.data.event[ 0 ];
			const isTerminalImportErrorEvent =
				eventName === ImporterEvents.IMPORT_ERROR ||
				eventName === BackupExtractEvents.BACKUP_EXTRACT_ERROR ||
				eventName === ValidatorEvents.IMPORT_VALIDATION_ERROR;

			logImportDebug( 'parsed import IPC event', {
				event: eventName,
			} );
			logImportDebug( 'sending IPC event to renderer', {
				channel: 'on-import',
				event: eventName,
				siteId,
				parentWindowAvailable: !! parentWindow && ! parentWindow.isDestroyed(),
			} );
			sendIpcEventToRendererWithWindow( parentWindow, 'on-import', parsed.data.event, siteId );

			if ( eventName === ImporterEvents.IMPORT_COMPLETE ) {
				importerType = parsed.data.event[ 1 ];
			}

			if ( isTerminalImportErrorEvent ) {
				logImportDebug( 'captured structured import error from IPC event', {
					event: eventName,
				} );
				structuredImportError = parsed.data.event[ 1 ];
				logImportDebug( 'terminal import error event detected; emitting failure immediately', {
					event: eventName,
				} );
				emitFailure( ensureError( structuredImportError, `Import failed during ${ eventName }` ) );
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
