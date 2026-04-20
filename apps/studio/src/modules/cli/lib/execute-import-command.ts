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
	const [ cliEventEmitter ] = executeCliCommand( args, { output: 'capture' } );
	const lifecycleEventEmitter = new TypedEventEmitter< ImportCliLifecycleEventMap >();
	let importerType: ImporterType | undefined;
	let structuredImportError: unknown;
	let didEmitFinalLifecycleEvent = false;

	function emitFailure( error: Error ) {
		if ( didEmitFinalLifecycleEvent ) {
			return;
		}
		didEmitFinalLifecycleEvent = true;

		if ( structuredImportError === undefined ) {
			sendIpcEventToRendererWithWindow(
				parentWindow,
				'on-import',
				[ ImporterEvents.IMPORT_ERROR, error ],
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
			sendIpcEventToRendererWithWindow( parentWindow, 'on-import', parsed.data.event, siteId );

			if ( parsed.data.event[ 0 ] === ImporterEvents.IMPORT_COMPLETE ) {
				importerType = parsed.data.event[ 1 ];
			}

			if ( parsed.data.event[ 0 ] === ImporterEvents.IMPORT_ERROR ) {
				structuredImportError = parsed.data.event[ 1 ];
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
