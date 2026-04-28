/**
 * WordPress Studio Server Child Process — Native PHP (stub)
 *
 * Placeholder runtime for the forthcoming native PHP binary implementation. Shares the same IPC
 * contract as `playground-server-child.ts`, but every non-abort message returns a
 * "not yet implemented" error so the manager surfaces a clean failure until the real runtime lands.
 */
import { z } from 'zod';
import { managerMessageSchema, ChildMessageRaw } from 'cli/lib/types/wordpress-server-ipc';

function logToConsole( ...args: Parameters< typeof console.log > ) {
	console.log( `[PHP Server]`, ...args );
}

function errorToConsole( ...args: Parameters< typeof console.error > ) {
	console.error( `[PHP Server]`, ...args );
}

function sendErrorMessage( messageId: string, error: unknown ): Promise< void > {
	return new Promise( ( resolve ) => {
		const errorResponse: ChildMessageRaw = {
			originalMessageId: messageId,
			topic: 'error',
			errorMessage:
				error instanceof Error ? error.message : 'Native PHP runtime is not yet implemented',
			errorStack: error instanceof Error ? error.stack : undefined,
		};
		process.send!( errorResponse, () => {
			resolve();
		} );
	} );
}

async function ipcMessageHandler( packet: unknown ) {
	const messageResult = managerMessageSchema.safeParse( packet );

	if ( ! messageResult.success ) {
		errorToConsole( 'Invalid message received:', messageResult.error );

		const minimalMessageSchema = z.object( { id: z.string() } );
		const minimalMessage = minimalMessageSchema.safeParse( packet );
		if ( minimalMessage.success ) {
			await sendErrorMessage( minimalMessage.data.id, messageResult.error );
		}
		return;
	}

	const validMessage = messageResult.data;
	logToConsole( `Received ${ validMessage.topic } message` );

	if ( validMessage.topic === 'abort' ) {
		return;
	}

	if ( validMessage.topic === 'stop-server' ) {
		const response: ChildMessageRaw = {
			originalMessageId: validMessage.messageId,
			topic: 'result',
			result: 'OK',
		};
		process.send!( response );
		process.exit();
		return;
	}

	await sendErrorMessage(
		validMessage.messageId,
		new Error( 'Native PHP runtime is not yet implemented' )
	);
}

if ( process.send ) {
	process.on( 'message', ipcMessageHandler );
	process.send( { topic: 'ready' } );
} else {
	throw new Error( 'process.send is not available' );
}
