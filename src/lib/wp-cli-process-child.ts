import { executeWPCli } from '../../vendor/wp-now/src/execute-wp-cli';
import { setupLogging } from '../logging';
import type { MessageName } from './wp-cli-process';

type Handler = ( message: string, messageId: number, data: unknown ) => void;
type Handlers = { [ K in MessageName ]: Handler };

// Setup logging for the forked process
if ( process.env.STUDIO_APP_LOGS_PATH ) {
	setupLogging( {
		processId: 'wp-cli-process',
		isForkedProcess: true,
		logDir: process.env.STUDIO_APP_LOGS_PATH,
	} );
}

const handlers: Handlers = {
	execute: createHandler( execute ),
};

async function execute( data: unknown ) {
	const { projectPath, args } = data as { projectPath: string; args: string[] };
	if ( ! projectPath || ! args ) {
		throw Error( 'Command execution needs project path and arguments' );
	}
	return await executeWPCli( projectPath, args );
}

function createHandler< T >( handler: ( data: unknown ) => T ) {
	return async ( message: string, messageId: number, data: unknown ) => {
		try {
			const response = await handler( data );
			process.parentPort.postMessage( {
				message,
				messageId,
				data: response,
			} );
		} catch ( error ) {
			const errorObj = error as Error;
			if ( ! errorObj ) {
				process.parentPort.postMessage( { message, messageId, error: Error( 'Unknown Error' ) } );
				return;
			}
			process.parentPort.postMessage( {
				message,
				messageId,
				error: errorObj,
			} );
		}
	};
}

process.parentPort.on( 'message', async ( { data: messagePayload } ) => {
	const { message, messageId, data }: { message: MessageName; messageId: number; data: unknown } =
		messagePayload;
	const handler = handlers[ message ];
	if ( ! handler ) {
		process.parentPort.postMessage( {
			message,
			messageId,
			error: Error( `No handler defined for message '${ message }'` ),
		} );
		return;
	}
	await handler( message, messageId, data );
} );
