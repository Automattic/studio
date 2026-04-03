import { fork, type ChildProcess } from 'node:child_process';
import { getBundledNodeBinaryPath, getCliPath } from 'src/storage/paths';

/**
 * Fork a short-lived CLI process to generate metadata.
 * Uses the CLI's auth infrastructure so we don't duplicate credential handling.
 */
function forkCliForMetadata(): ChildProcess {
	return fork( getCliPath(), [ 'ai', 'agent', '--avoid-telemetry' ], {
		stdio: [ 'ignore', 'pipe', 'pipe', 'ipc' ],
		execPath: getBundledNodeBinaryPath(),
		execArgv: [ '--experimental-wasm-jspi' ],
		env: { ...process.env },
	} );
}

function requestFromCli< T >(
	sendMessage: Record< string, unknown >,
	resultType: string,
	resultKey: string
): Promise< T | null > {
	return new Promise( ( resolve ) => {
		const child = forkCliForMetadata();
		const timeout = setTimeout( () => {
			child.kill();
			resolve( null );
		}, 15000 );

		child.on( 'message', ( raw: unknown ) => {
			const msg = raw as { type: string; [ key: string ]: unknown };

			if ( msg.type === 'ai:ready' ) {
				child.send( sendMessage );
			} else if ( msg.type === resultType ) {
				clearTimeout( timeout );
				resolve( ( msg[ resultKey ] as T ) ?? null );
				child.send( { type: 'ai:kill' } );
			}
		} );

		child.on( 'error', () => {
			clearTimeout( timeout );
			resolve( null );
		} );

		child.on( 'close', () => {
			clearTimeout( timeout );
			resolve( null );
		} );
	} );
}

/**
 * Generate a concise task title from the user's first message.
 */
export async function generateTitle( prompt: string ): Promise< string | null > {
	return requestFromCli< string >(
		{ type: 'ai:generate-title', prompt },
		'ai:title-result',
		'title'
	);
}

/**
 * Generate a brief task summary from available context.
 */
export async function generateSummary( context: {
	title: string;
	firstMessage: string;
	firstResponse?: string;
	siteName?: string;
} ): Promise< string | null > {
	return requestFromCli< string >(
		{ type: 'ai:generate-summary', ...context },
		'ai:summary-result',
		'summary'
	);
}
