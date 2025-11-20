/**
 * WordPress Server Manager for Studio CLI
 *
 * Manages WordPress server processes via PM2. Each site runs as its own
 * PM2 daemon process using the Playground CLI provider.
 *
 * Pattern follows Studio's PlaygroundServerProcess class but uses PM2 instead of Electron's utilityProcess
 */
import path from 'path';
import { SiteData } from 'cli/lib/appdata';
import {
	isProcessRunning,
	startProcess,
	stopProcess,
	getProcessStatus,
	getPm2Instance,
} from 'cli/lib/pm2-manager';
import { ProcessDescription } from 'cli/lib/types/pm2';
import { ServerConfig, Message } from 'cli/lib/types/wordpress-server';
import {
	PLAYGROUND_CLI_ACTIVITY_CHECK_INTERVAL,
	PLAYGROUND_CLI_INACTIVITY_TIMEOUT,
	PLAYGROUND_CLI_MAX_TIMEOUT,
} from '../../common/constants';

const pm2 = getPm2Instance();

// PM2 bus for inter-process communication
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let pm2Bus: any = null;

async function getPm2Bus() {
	if ( pm2Bus ) {
		return pm2Bus;
	}

	return new Promise( ( resolve, reject ) => {
		pm2.launchBus( ( error, bus ) => {
			if ( error ) {
				reject( error );
				return;
			}
			pm2Bus = bus;
			resolve( bus );
		} );
	} );
}

const activityTrackers = new Map<
	number,
	{
		lastActivityTimestamp: number;
		activityCheckInterval: NodeJS.Timeout;
	}
>();

/**
 * Generate PM2 process name for a site
 */
function getProcessName( siteId: string ): string {
	return `studio-site-${ siteId }`;
}

/**
 * Check if a WordPress server is running for a site
 */
export async function isServerRunning( siteId: string ): Promise< boolean > {
	const processName = getProcessName( siteId );
	return isProcessRunning( processName );
}

/**
 * Start a WordPress server for a site via PM2
 * Follows Studio's PlaygroundServerProcess.start() pattern:
 * 1. Start the PM2 process
 * 2. Wait for 'ready' message
 * 3. Send 'start-server' message with config
 * 4. Wait for response before resolving
 */
export async function startWordPressServer(
	site: SiteData,
	consoleMessageCallback?: ( message: string ) => void
): Promise< ProcessDescription > {
	const wordPressDaemonPath = path.resolve( __dirname, 'wordpress-daemon.js' );
	const processName = getProcessName( site.id );

	const serverConfig: ServerConfig = {
		siteId: site.id,
		sitePath: site.path,
		port: site.port,
		phpVersion: site.phpVersion,
		siteTitle: site.name,
	};

	if ( site.customDomain ) {
		const protocol = site.enableHttps ? 'https' : 'http';
		serverConfig.absoluteUrl = `${ protocol }://${ site.customDomain }`;
	}

	if ( site.adminPassword ) {
		serverConfig.adminPassword = site.adminPassword;
	}

	if ( site.isWpAutoUpdating !== undefined ) {
		serverConfig.isWpAutoUpdating = site.isWpAutoUpdating;
	}

	const env = {
		STUDIO_WORDPRESS_SERVER_CONFIG: JSON.stringify( serverConfig ),
	};

	const processDesc = await startProcess( processName, wordPressDaemonPath, env );

	if ( consoleMessageCallback ) {
		setupConsoleMessageHandler( processDesc.pmId, consoleMessageCallback );
	}

	await waitForReadyMessage( processName, processDesc.pmId );

	await sendMessage( processName, processDesc.pmId, 'start-server', { config: serverConfig } );

	return processDesc;
}

/**
 * Set up handler for console messages from PM2 process
 */
function setupConsoleMessageHandler( pmId: number, callback: ( message: string ) => void ): void {
	getPm2Bus()
		.then( ( bus ) => {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const consoleHandler = ( packet: any ) => {
				if (
					packet?.process?.pm_id === pmId &&
					packet?.raw?.type === 'console-message' &&
					packet?.raw?.message
				) {
					callback( packet.raw.message );
				}
			};

			bus.on( 'process:msg', consoleHandler );
		} )
		.catch( ( error ) => {
			console.error( 'Failed to set up console message handler:', error );
		} );
}

/**
 * Wait for 'ready' message from PM2 process
 */
async function waitForReadyMessage( processName: string, pmId: number ): Promise< void > {
	const bus = await getPm2Bus();

	return new Promise( ( resolve, reject ) => {
		const timeout = setTimeout( () => {
			bus.off( 'process:msg', readyHandler );
			reject( new Error( 'Timeout waiting for ready message from WordPress daemon' ) );
		}, PLAYGROUND_CLI_INACTIVITY_TIMEOUT );

		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const readyHandler = ( packet: any ) => {
			if ( packet?.process?.pm_id === pmId && packet?.raw?.type === 'ready' ) {
				clearTimeout( timeout );
				bus.off( 'process:msg', readyHandler );
				resolve();
			}
		};

		bus.on( 'process:msg', readyHandler );
	} );
}

/**
 * Send message to PM2 process and wait for response with activity-based timeout
 * Similar to Studio's sendMessage pattern (lines 184-227 in playground-server-process.ts)
 *
 * Implements activity-based timeout system:
 * - Tracks last activity timestamp
 * - Checks periodically for inactivity
 * - Has both inactivity timeout and max total timeout
 */
let nextMessageId = 0;

async function sendMessage(
	processName: string,
	pmId: number,
	type: string,
	data: Message[ 'data' ]
): Promise< unknown > {
	const bus = await getPm2Bus();

	return new Promise( ( resolve, reject ) => {
		const id = nextMessageId++;
		const message: Message = { id, type, data };

		const startTime = Date.now();
		let lastActivityTimestamp = Date.now();

		const cleanup = () => {
			bus.off( 'process:msg', responseHandler );
			const tracker = activityTrackers.get( id );
			if ( tracker ) {
				clearInterval( tracker.activityCheckInterval );
				activityTrackers.delete( id );
			}
		};

		const activityCheckInterval = setInterval( () => {
			const now = Date.now();
			const timeSinceLastActivity = now - lastActivityTimestamp;
			const totalElapsedTime = now - startTime;

			if (
				timeSinceLastActivity > PLAYGROUND_CLI_INACTIVITY_TIMEOUT ||
				totalElapsedTime > PLAYGROUND_CLI_MAX_TIMEOUT
			) {
				cleanup();
				const timeoutReason =
					totalElapsedTime > PLAYGROUND_CLI_MAX_TIMEOUT
						? `Maximum timeout of ${ PLAYGROUND_CLI_MAX_TIMEOUT / 1000 }s exceeded`
						: `No activity for ${ PLAYGROUND_CLI_INACTIVITY_TIMEOUT / 1000 }s`;
				reject(
					new Error( `Timeout waiting for response to message ${ id }: ${ timeoutReason }` )
				);
			}
		}, PLAYGROUND_CLI_ACTIVITY_CHECK_INTERVAL );

		activityTrackers.set( id, {
			lastActivityTimestamp,
			activityCheckInterval,
		} );

		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const responseHandler = ( packet: any ) => {
			if ( packet?.process?.pm_id === pmId ) {
				if ( packet?.raw?.type === 'activity' || packet?.raw?.id !== undefined ) {
					lastActivityTimestamp = Date.now();
					const tracker = activityTrackers.get( id );
					if ( tracker ) {
						tracker.lastActivityTimestamp = lastActivityTimestamp;
					}
				}
			}

			if ( packet?.process?.pm_id === pmId && packet?.raw?.id === id ) {
				cleanup();

				if ( packet.raw.error ) {
					const error = new Error( packet.raw.error ) as Error & {
						errorStack?: string;
					};
					if ( packet.raw.errorStack ) {
						error.stack = packet.raw.errorStack;
					}
					reject( error );
				} else {
					resolve( packet.raw.result );
				}
			}
		};

		bus.on( 'process:msg', responseHandler );

		// Send message via PM2 bus using process ID
		pm2.sendDataToProcessId(
			pmId,
			{
				type: 'process:msg',
				data: message,
				topic: true,
			},
			( error ) => {
				if ( error ) {
					cleanup();
					reject( error );
				}
			}
		);
	} );
}

/**
 * Stop a WordPress server for a site
 */
export async function stopWordPressServer( siteId: string ): Promise< void > {
	const processName = getProcessName( siteId );
	return stopProcess( processName );
}

/**
 * Get status of a WordPress server
 */
export async function getServerStatus( siteId: string ): Promise< ProcessDescription | null > {
	const processName = getProcessName( siteId );
	return getProcessStatus( processName );
}
