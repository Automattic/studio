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
		if ( didEmitFinalLifecycleEvent ) {
			return;
		}
		didEmitFinalLifecycleEvent = true;

		if ( structuredImportError === undefined ) {
			sendIpcEventToRendererWithWindow(
				parentWindow,
				'on-import',
				[ ImporterEvents.IMPORT_ERROR, error.message ],
				siteId
			);
		}

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

			sendIpcEventToRendererWithWindow( parentWindow, 'on-import', parsed.data.event, siteId );

			if ( eventName === ImporterEvents.IMPORT_COMPLETE ) {
				importerType = parsed.data.event[ 1 ];
			}

			if ( isTerminalImportErrorEvent ) {
				structuredImportError = parsed.data.event[ 1 ];
				emitFailure( ensureError( structuredImportError, `Import failed during ${ eventName }` ) );
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
		lifecycleEventEmitter.emit( 'completed', {
			importerType,
		} );
	} );

	return lifecycleEventEmitter;
}
