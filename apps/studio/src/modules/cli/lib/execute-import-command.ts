import { ImporterEvents, importIpcEventSchema } from '@studio/common/lib/import-export-events';
import { sendIpcEventToRendererWithWindow } from 'src/ipc-utils';
import { executeCliCommand } from 'src/modules/cli/lib/execute-command';

export async function executeImportCliCommand(
	siteId: string,
	args: string[],
	parentWindow: Electron.BrowserWindow | null
) {
	const [ cliEventEmitter ] = executeCliCommand( args, { output: 'capture' } );

	cliEventEmitter.on( 'data', ( { data } ) => {
		const parsed = importIpcEventSchema.safeParse( data );

		if ( parsed.success ) {
			sendIpcEventToRendererWithWindow( parentWindow, 'on-import', parsed.data.event, siteId );
		}
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

	return cliEventEmitter;
}
