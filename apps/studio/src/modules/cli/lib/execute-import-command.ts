import { ImporterEvents, importEventTupleSchema } from '@studio/common/lib/import-export-events';
import { z } from 'zod';
import { sendIpcEventToRendererWithWindow } from 'src/ipc-utils';
import { executeCliCommand } from 'src/modules/cli/lib/execute-command';

const importEventSchema = z.object( {
	event: importEventTupleSchema,
} );

export async function executeImportCliCommand(
	siteId: string,
	args: string[],
	parentWindow: Electron.BrowserWindow | null
): Promise< void > {
	const [ cliEventEmitter ] = executeCliCommand( args, { output: 'capture' } );

	cliEventEmitter.on( 'data', ( { data } ) => {
		const parsed = importEventSchema.safeParse( data );

		if ( ! parsed.success ) {
			console.error( 'Invalid import event:', parsed.error );
			return;
		}

		sendIpcEventToRendererWithWindow( parentWindow, 'on-import', parsed.data.event, siteId );
	} );

	cliEventEmitter.on( 'error', ( { error } ) => {
		sendIpcEventToRendererWithWindow(
			parentWindow,
			'on-import',
			[ ImporterEvents.IMPORT_ERROR, error ],
			siteId
		);
	} );

	cliEventEmitter.on( 'failure', ( { error } ) => {
		sendIpcEventToRendererWithWindow(
			parentWindow,
			'on-import',
			[ ImporterEvents.IMPORT_ERROR, error ],
			siteId
		);
	} );

	cliEventEmitter.on( 'success', () => {
		// Do nothing for now
	} );
}
