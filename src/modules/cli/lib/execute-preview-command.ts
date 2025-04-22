import crypto from 'crypto';
import { z } from 'zod';
import { PreviewCommandLoggerAction } from 'common/logger-actions';
import { sendIpcEventToRendererWithWindow } from 'src/ipc-utils';
import { executeCliCommand } from 'src/modules/cli/lib/execute-command';

const snapshotEventSchema = z.object( {
	action: z.nativeEnum( PreviewCommandLoggerAction ),
	status: z.enum( [ 'inprogress', 'fail', 'success' ] ),
	message: z.string(),
} );

const createSnapshotStdoutSchema = z.discriminatedUnion( 'action', [
	snapshotEventSchema,
	z.object( {
		action: z.literal( 'keyValuePair' ),
		key: z.string(),
		value: z.string(),
	} ),
] );

function parseSnapshotEventData< T extends z.ZodType >(
	data: unknown,
	schema: T
): z.infer< T > | null {
	try {
		return schema.parse( data );
	} catch ( error ) {
		console.error( 'Invalid snapshot event:', error );
		return null;
	}
}

export async function executePreviewCliCommand(
	args: string[],
	parentWindow: Electron.BrowserWindow | null
): Promise< { operationId: crypto.UUID } > {
	const operationId = crypto.randomUUID();
	const cliEventEmitter = executeCliCommand( args );

	cliEventEmitter.on( 'data', ( { data } ) => {
		const parsed = parseSnapshotEventData( data, createSnapshotStdoutSchema );

		if ( ! parsed ) {
			return;
		}

		if ( parsed.action === 'keyValuePair' ) {
			sendIpcEventToRendererWithWindow( parentWindow, 'snapshot-key-value', {
				operationId,
				data: parsed,
			} );
		} else {
			sendIpcEventToRendererWithWindow( parentWindow, 'snapshot-output', {
				operationId,
				data: parsed,
			} );
		}
	} );

	cliEventEmitter.on( 'error', ( { error } ) => {
		const parsed = parseSnapshotEventData( error, snapshotEventSchema );

		if ( parsed ) {
			sendIpcEventToRendererWithWindow( parentWindow, 'snapshot-error', {
				operationId,
				data: parsed,
			} );
		}
	} );

	cliEventEmitter.on( 'fatal-error', ( { error } ) => {
		sendIpcEventToRendererWithWindow( parentWindow, 'snapshot-fatal-error', {
			operationId,
			data: { message: error.message },
		} );
	} );

	cliEventEmitter.on( 'success', () => {
		sendIpcEventToRendererWithWindow( parentWindow, 'snapshot-success', {
			operationId,
		} );
	} );

	return { operationId };
}
