import crypto from 'crypto';
import { z } from 'zod';
import { PreviewCommandLoggerAction } from 'common/logger-actions';
import { sendIpcEventToRendererWithWindow } from 'src/ipc-utils';
import { executeCliCommand } from 'src/modules/cli/lib/execute-command';

const snapshotEventSchema = z.discriminatedUnion( 'action', [
	z.object( {
		action: z.enum( PreviewCommandLoggerAction ),
		status: z.enum( [ 'inprogress', 'fail', 'success' ] ),
		message: z.string(),
	} ),
	z.object( {
		action: z.literal( 'keyValuePair' ),
		key: z.string(),
		value: z.string(),
	} ),
] );

export async function executePreviewCliCommand(
	args: string[],
	parentWindow: Electron.BrowserWindow | null
): Promise< { operationId: crypto.UUID } > {
	const operationId = crypto.randomUUID();
	const [ cliEventEmitter ] = executeCliCommand( args, { output: 'capture' } );

	cliEventEmitter.on( 'data', ( { data } ) => {
		const parsed = snapshotEventSchema.safeParse( data );

		if ( ! parsed.success ) {
			console.error( 'Invalid snapshot event:', parsed.error );
			return;
		}

		if ( parsed.data.action === 'keyValuePair' ) {
			sendIpcEventToRendererWithWindow( parentWindow, 'snapshot-key-value', {
				operationId,
				data: parsed.data,
			} );
		} else if ( parsed.data.status === 'fail' ) {
			sendIpcEventToRendererWithWindow( parentWindow, 'snapshot-error', {
				operationId,
				data: parsed.data,
			} );
		} else {
			sendIpcEventToRendererWithWindow( parentWindow, 'snapshot-output', {
				operationId,
				data: parsed.data,
			} );
		}
	} );

	cliEventEmitter.on( 'error', ( { error } ) => {
		sendIpcEventToRendererWithWindow( parentWindow, 'snapshot-fatal-error', {
			operationId,
			data: { message: error.message },
		} );
	} );

	cliEventEmitter.on( 'failure', ( { result, lastErrorMessage } ) => {
		const errorDetail =
			lastErrorMessage || result.stderr.trim() || result.stdout.trim() || 'Unknown error';

		sendIpcEventToRendererWithWindow( parentWindow, 'snapshot-fatal-error', {
			operationId,
			data: { message: errorDetail },
		} );
	} );

	cliEventEmitter.on( 'success', () => {
		sendIpcEventToRendererWithWindow( parentWindow, 'snapshot-success', {
			operationId,
		} );
	} );

	return { operationId };
}
