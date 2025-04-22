import crypto from 'crypto';
import { z } from 'zod';
import { CreateLoggerAction } from 'cli/commands/preview/logger-actions';
import { sendIpcEventToRendererWithWindow } from 'src/ipc-utils';
import { executeCliCommand } from 'src/modules/cli/lib/execute-command';

const createSnapshotEventSchema = z.object( {
	action: z.nativeEnum( CreateLoggerAction ),
	status: z.enum( [ 'inprogress', 'fail', 'success' ] ),
	message: z.string(),
} );

const createSnapshotStdoutSchema = z.discriminatedUnion( 'action', [
	createSnapshotEventSchema,
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

	cliEventEmitter.on( 'data', ( data: unknown ) => {
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

	cliEventEmitter.on( 'error', ( data: unknown ) => {
		const parsed = parseSnapshotEventData( data, createSnapshotEventSchema );

		if ( parsed ) {
			sendIpcEventToRendererWithWindow( parentWindow, 'snapshot-error', {
				operationId,
				data: parsed,
			} );
		}
	} );

	cliEventEmitter.on( 'success', () => {
		sendIpcEventToRendererWithWindow( parentWindow, 'snapshot-success', {
			operationId,
		} );
	} );

	return { operationId };
}
