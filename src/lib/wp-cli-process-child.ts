import { setupLogging } from 'src/logging';
import type { MessageName } from 'src/lib/wp-cli-process';

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
	const { projectPath, args, phpVersion, resourcesPath, sqliteCommandPath } = data as {
		projectPath: string;
		args: string[];
		phpVersion: string;
		resourcesPath?: string;
		sqliteCommandPath?: string;
	};
	if ( ! projectPath || ! args ) {
		throw Error( 'Command execution needs project path and arguments' );
	}

	// Lazy load the provider based on environment variable
	const providerType = process.env.WORDPRESS_PROVIDER_TYPE || 'wp-now';

	switch ( providerType ) {
		case 'wp-now': {
			const { executeWPCli } = await import( 'vendor/wp-now/src/execute-wp-cli' );
			return await executeWPCli( projectPath, args, { phpVersion } );
		}
		case 'playground-cli': {
			const { executeWPCli } = await import(
				'src/lib/wordpress-provider/playground-cli/wp-cli-executor'
			);

			if ( ! resourcesPath || ! sqliteCommandPath ) {
				throw new Error( 'Required paths not provided for playground-cli provider' );
			}

			return await executeWPCli( projectPath, args, {
				phpVersion,
				resourcesPath,
				sqliteCommandPath,
			} );
		}
		default:
			throw new Error( `Unknown WordPress provider type: ${ providerType }` );
	}
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
			process.parentPort.postMessage( {
				message,
				messageId,
				error: errorObj?.message || 'Unknown Error',
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
