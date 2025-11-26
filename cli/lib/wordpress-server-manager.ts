/**
 * WordPress Server Manager for Studio CLI
 *
 * Manages WordPress server processes via PM2. Each site runs as its own
 * PM2 daemon process using the Playground CLI provider.
 */
import path from 'path';
import {
	PLAYGROUND_CLI_ACTIVITY_CHECK_INTERVAL,
	PLAYGROUND_CLI_INACTIVITY_TIMEOUT,
	PLAYGROUND_CLI_MAX_TIMEOUT,
} from 'common/constants';
import { SiteData } from 'cli/lib/appdata';
import {
	isProcessRunning,
	startProcess,
	stopProcess,
	getPm2Bus,
	sendMessageToProcess,
} from 'cli/lib/pm2-manager';
import { ProcessDescription } from 'cli/lib/types/pm2';
import {
	ServerConfig,
	childMessagePm2Schema,
	ManagerMessage,
} from 'cli/lib/types/wordpress-server-ipc';

/**
 * Generate PM2 process name for a site
 */
function getProcessName( siteId: string ): string {
	return `studio-site-${ siteId }`;
}

export async function isServerRunning( siteId: string ): Promise< ProcessDescription | undefined > {
	const processName = getProcessName( siteId );
	return isProcessRunning( processName );
}

/**
 * Start a WordPress server for a site via PM2
 * 1. Start the PM2 process
 * 2. Wait for 'ready' message
 * 3. Send 'start-server' message with config
 * 4. Wait for response before resolving
 */
export async function startWordPressServer( site: SiteData ): Promise< ProcessDescription > {
	const wordPressServerChildPath = path.resolve( __dirname, 'wordpress-server-child.js' );
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

	const processDesc = await startProcess( processName, wordPressServerChildPath, env );
	await waitForReadyMessage( processDesc.pmId );
	await sendMessage( processDesc.pmId, {
		topic: 'start-server',
		data: { config: serverConfig },
	} );

	return processDesc;
}

async function waitForReadyMessage( pmId: number ): Promise< void > {
	const bus = await getPm2Bus();

	return new Promise( ( resolve, reject ) => {
		const timeout = setTimeout( () => {
			bus.off( 'process:msg', readyHandler );
			reject( new Error( 'Timeout waiting for ready message from WordPress server child' ) );
		}, PLAYGROUND_CLI_INACTIVITY_TIMEOUT );

		const readyHandler = ( packet: unknown ) => {
			const result = childMessagePm2Schema.safeParse( packet );
			if ( ! result.success ) {
				return;
			}

			if ( result.data.process.pm_id === pmId && result.data.raw.topic === 'ready' ) {
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
 * Implements activity-based timeout system:
 * - Tracks last activity timestamp
 * - Checks periodically for inactivity
 * - Has both inactivity timeout and max total timeout
 */
let nextMessageId = 0;
const messageActivityTrackers = new Map<
	number,
	{
		lastActivityTimestamp: number;
		activityCheckIntervalId: NodeJS.Timeout;
	}
>();

async function sendMessage(
	pmId: number,
	message: Omit< ManagerMessage, 'messageId' >
): Promise< unknown > {
	const bus = await getPm2Bus();

	return new Promise( ( resolve, reject ) => {
		const messageId = nextMessageId++;
		const startTime = Date.now();
		let lastActivityTimestamp = Date.now();

		const cleanup = () => {
			bus.off( 'process:msg', responseHandler );
			const tracker = messageActivityTrackers.get( messageId );
			if ( tracker ) {
				clearInterval( tracker.activityCheckIntervalId );
				messageActivityTrackers.delete( messageId );
			}
		};

		const activityCheckIntervalId = setInterval( () => {
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
					new Error( `Timeout waiting for response to message ${ messageId }: ${ timeoutReason }` )
				);
			}
		}, PLAYGROUND_CLI_ACTIVITY_CHECK_INTERVAL );

		messageActivityTrackers.set( messageId, {
			lastActivityTimestamp,
			activityCheckIntervalId,
		} );

		const responseHandler = ( packet: unknown ) => {
			const validationResult = childMessagePm2Schema.safeParse( packet );
			if ( ! validationResult.success ) {
				cleanup();
				reject( validationResult.error );
				return;
			}

			const validPacket = validationResult.data;

			if ( validPacket.process.pm_id !== pmId ) {
				return;
			}

			if ( validPacket.raw.topic === 'activity' ) {
				lastActivityTimestamp = Date.now();
				const tracker = messageActivityTrackers.get( messageId );
				if ( tracker ) {
					tracker.lastActivityTimestamp = lastActivityTimestamp;
				}
			} else if ( validPacket.raw.topic === 'error' ) {
				const error = new Error( validPacket.raw.errorMessage );
				if ( validPacket.raw.errorStack ) {
					error.stack = validPacket.raw.errorStack;
				}
				cleanup();
				reject( error );
			} else if (
				validPacket.raw.topic === 'result' &&
				validPacket.raw.originalMessageId === messageId
			) {
				cleanup();
				resolve( validPacket.raw.result );
			}
		};

		bus.on( 'process:msg', responseHandler );

		sendMessageToProcess( pmId, { ...message, messageId: messageId } ).catch( reject );
	} );
}

export async function stopWordPressServer( siteId: string ): Promise< void > {
	const processName = getProcessName( siteId );
	return stopProcess( processName );
}
