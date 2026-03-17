/**
 * WordPress Server Manager for Studio CLI
 *
 * Manages WordPress server processes via process manager daemon. Each site runs in a separate
 * process that spawns Playground CLI.
 */
import path from 'path';
import {
	PLAYGROUND_CLI_ACTIVITY_CHECK_INTERVAL,
	PLAYGROUND_CLI_INACTIVITY_TIMEOUT,
	PLAYGROUND_CLI_MAX_TIMEOUT,
} from '@studio/common/constants';
import { SITE_EVENTS } from '@studio/common/lib/site-events';
import { z } from 'zod';
import { SiteData } from 'cli/lib/appdata';
import {
	isProcessRunning,
	startProcess,
	stopProcess,
	getDaemonBus,
	type DaemonBusEventMap,
	sendMessageToProcess,
} from 'cli/lib/daemon-client';
import { ProcessDescription } from 'cli/lib/types/process-manager-ipc';
import { ServerConfig, ManagerMessagePayload } from 'cli/lib/types/wordpress-server-ipc';
import { Logger } from 'cli/logger';

export const SITE_PROCESS_PREFIX = 'studio-site-';

// Get an abort signal that's triggered on SIGINT/SIGTERM. This is useful for aborting and cleaning
// up async operations.
const abortController = new AbortController();
process.on( 'SIGINT', () => abortController.abort() );
process.on( 'SIGTERM', () => abortController.abort() );

export function getProcessName( siteId: string ): string {
	return `${ SITE_PROCESS_PREFIX }${ siteId }`;
}

export async function isServerRunning( siteId: string ): Promise< ProcessDescription | undefined > {
	const processName = getProcessName( siteId );
	return isProcessRunning( processName );
}

/**
 * Start a WordPress server for a site via process manager daemon
 * 1. Start the process (via the process manager daemon)
 * 2. Wait for 'ready' message
 * 3. Send 'start-server' message with config
 * 4. Wait for response before resolving
 */
export interface StartServerOptions {
	wpVersion?: string;
	blueprint?: unknown;
	blueprintUri?: string;
}

export async function startWordPressServer(
	site: SiteData,
	logger: Logger< string >,
	options?: StartServerOptions
): Promise< ProcessDescription > {
	const wordPressServerChildPath = path.resolve( import.meta.dirname, 'wordpress-server-child.js' );
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

	if ( site.adminUsername ) {
		serverConfig.adminUsername = site.adminUsername;
	}

	if ( site.adminPassword ) {
		serverConfig.adminPassword = site.adminPassword;
	}

	if ( site.adminEmail ) {
		serverConfig.adminEmail = site.adminEmail;
	}

	if ( site.isWpAutoUpdating !== undefined ) {
		serverConfig.isWpAutoUpdating = site.isWpAutoUpdating;
	}

	if ( options?.wpVersion ) {
		serverConfig.wpVersion = options.wpVersion;
	}

	if ( options?.blueprint && options.blueprintUri ) {
		serverConfig.blueprint = {
			contents: options.blueprint,
			uri: options.blueprintUri,
		};
	}

	if ( site.enableXdebug ) {
		serverConfig.enableXdebug = true;
	}

	if ( site.enableDebugLog ) {
		serverConfig.enableDebugLog = true;
	}

	if ( site.enableDebugDisplay ) {
		serverConfig.enableDebugDisplay = true;
	}

	if ( site.enablePhpMyAdmin ) {
		serverConfig.enablePhpMyAdmin = true;
	}

	const processDesc = await startProcess( processName, wordPressServerChildPath );
	await waitForReadyMessage( processDesc.pmId );
	await sendMessage(
		processDesc.pmId,
		processName,
		{
			topic: 'start-server',
			data: { config: serverConfig },
		},
		{ logger }
	);

	return processDesc;
}

async function waitForReadyMessage( pmId: number ): Promise< void > {
	const bus = await getDaemonBus();

	let timeoutId: NodeJS.Timeout;
	let readyHandler: ( packet: DaemonBusEventMap[ 'process-message' ] ) => void;
	let abortListener: () => void;

	return new Promise< void >( ( resolve, reject ) => {
		timeoutId = setTimeout( () => {
			reject( new Error( 'Timeout waiting for ready message from WordPress server child' ) );
		}, PLAYGROUND_CLI_INACTIVITY_TIMEOUT );
		readyHandler = ( packet ) => {
			if ( packet.process.pm_id === pmId && packet.raw.topic === 'ready' ) {
				resolve();
			}
		};
		abortListener = () => {
			reject( new Error( 'Operation aborted' ) );
		};
		abortController.signal.addEventListener( 'abort', abortListener );

		bus.on( 'process-message', readyHandler );
	} ).finally( () => {
		clearTimeout( timeoutId );
		abortController.signal.removeEventListener( 'abort', abortListener );
		bus.off( 'process-message', readyHandler );
	} );
}

const messageActivityTrackers = new Map<
	string,
	{
		activityCheckIntervalId: NodeJS.Timeout;
	}
>();

export interface SendMessageOptions {
	maxTotalElapsedTime?: number;
	logger?: Logger< string >;
}

/**
 * Send message to process (via the process manager daemon) and wait for response with
 * activity-based timeout.
 * - Tracks last activity timestamp
 * - Checks periodically for inactivity
 * - Has both inactivity timeout and max total timeout
 */
export async function sendMessage(
	pmId: number,
	processName: string,
	message: ManagerMessagePayload,
	options: SendMessageOptions = {}
): Promise< unknown > {
	const { maxTotalElapsedTime = PLAYGROUND_CLI_MAX_TIMEOUT, logger } = options;
	const bus = await getDaemonBus();
	const messageId = crypto.randomUUID();
	let responseHandler: ( packet: DaemonBusEventMap[ 'process-message' ] ) => void;
	let processEventHandler: ( event: DaemonBusEventMap[ 'process-event' ] ) => void;
	let abortListener: () => void;

	return new Promise( ( resolve, reject ) => {
		const startTime = Date.now();
		let lastActivityTimestamp = Date.now();

		const activityCheckIntervalId = setInterval( () => {
			const now = Date.now();
			const timeSinceLastActivity = now - lastActivityTimestamp;
			const totalElapsedTime = now - startTime;

			if (
				timeSinceLastActivity > PLAYGROUND_CLI_INACTIVITY_TIMEOUT ||
				totalElapsedTime > maxTotalElapsedTime
			) {
				const timeoutReason =
					totalElapsedTime > maxTotalElapsedTime
						? `Maximum timeout of ${ maxTotalElapsedTime / 1000 }s exceeded`
						: `No activity for ${ PLAYGROUND_CLI_INACTIVITY_TIMEOUT / 1000 }s`;
				reject(
					new Error( `Timeout waiting for response to message ${ messageId }: ${ timeoutReason }` )
				);
			}
		}, PLAYGROUND_CLI_ACTIVITY_CHECK_INTERVAL );

		messageActivityTrackers.set( messageId, {
			activityCheckIntervalId,
		} );

		processEventHandler = ( event ) => {
			if ( event.process.name === processName && event.event === 'exit' ) {
				reject( new Error( 'WordPress server process exited unexpectedly' ) );
			}
		};

		responseHandler = ( packet ) => {
			if ( packet.process.pm_id !== pmId ) {
				return;
			}

			if ( packet.raw.topic === 'activity' ) {
				lastActivityTimestamp = Date.now();
			} else if ( packet.raw.topic === 'console-message' ) {
				lastActivityTimestamp = Date.now();
				logger?.reportProgress( packet.raw.message );
			} else if ( packet.raw.topic === 'error' && packet.raw.originalMessageId === messageId ) {
				const error = new Error( packet.raw.errorMessage ) as Error & {
					cliArgs?: Record< string, unknown >;
				};
				if ( packet.raw.errorStack ) {
					error.stack = packet.raw.errorStack;
				}
				if ( packet.raw.cliArgs ) {
					error.cliArgs = packet.raw.cliArgs;
				}
				reject( error );
			} else if ( packet.raw.topic === 'result' && packet.raw.originalMessageId === messageId ) {
				resolve( packet.raw.result );
			}
		};

		abortListener = () => {
			void sendMessageToProcess( pmId, { messageId, topic: 'abort', data: {} } );
			reject( new Error( 'Operation aborted' ) );
		};
		abortController.signal.addEventListener( 'abort', abortListener );

		bus.on( 'process-event', processEventHandler );
		bus.on( 'process-message', responseHandler );

		sendMessageToProcess( pmId, { ...message, messageId } ).catch( reject );
	} ).finally( () => {
		abortController.signal.removeEventListener( 'abort', abortListener );
		bus.off( 'process-event', processEventHandler );
		bus.off( 'process-message', responseHandler );

		const tracker = messageActivityTrackers.get( messageId );
		if ( tracker ) {
			clearInterval( tracker.activityCheckIntervalId );
			messageActivityTrackers.delete( messageId );
		}
	} );
}

const GRACEFUL_STOP_TIMEOUT = 5000;

export async function stopWordPressServer( siteId: string ): Promise< void > {
	const processName = getProcessName( siteId );
	const runningProcess = await isProcessRunning( processName );

	if ( runningProcess ) {
		try {
			await sendMessage(
				runningProcess.pmId,
				processName,
				{ topic: 'stop-server', data: {} },
				{ maxTotalElapsedTime: GRACEFUL_STOP_TIMEOUT }
			);
		} catch {
			// Graceful shutdown failed, `stopProcess()` will handle it
		}
	}

	return stopProcess( processName );
}

export interface RunBlueprintOptions {
	wpVersion?: string;
	blueprint: unknown;
	blueprintUri: string;
}

/**
 * Run a blueprint on a site without starting a server
 * 1. Start the process (via the process manager daemon)
 * 2. Wait for 'ready' message
 * 3. Send 'run-blueprint' message with config
 * 4. Wait for completion
 * 5. Stop the process
 */
export async function runBlueprint(
	site: SiteData,
	logger: Logger< string >,
	options: RunBlueprintOptions
): Promise< void > {
	const wordPressServerChildPath = path.resolve( import.meta.dirname, 'wordpress-server-child.js' );
	const processName = getProcessName( site.id );

	const serverConfig: ServerConfig = {
		siteId: site.id,
		sitePath: site.path,
		port: site.port,
		phpVersion: site.phpVersion,
		siteTitle: site.name,
		blueprint: {
			contents: options.blueprint,
			uri: options.blueprintUri,
		},
	};

	if ( site.customDomain ) {
		const protocol = site.enableHttps ? 'https' : 'http';
		serverConfig.absoluteUrl = `${ protocol }://${ site.customDomain }`;
	}

	if ( site.adminUsername ) {
		serverConfig.adminUsername = site.adminUsername;
	}

	if ( site.adminPassword ) {
		serverConfig.adminPassword = site.adminPassword;
	}

	if ( site.adminEmail ) {
		serverConfig.adminEmail = site.adminEmail;
	}

	if ( site.isWpAutoUpdating !== undefined ) {
		serverConfig.isWpAutoUpdating = site.isWpAutoUpdating;
	}

	if ( options.wpVersion ) {
		serverConfig.wpVersion = options.wpVersion;
	}

	if ( site.enableXdebug ) {
		serverConfig.enableXdebug = true;
	}

	if ( site.enableDebugLog ) {
		serverConfig.enableDebugLog = true;
	}

	if ( site.enableDebugDisplay ) {
		serverConfig.enableDebugDisplay = true;
	}

	if ( site.enablePhpMyAdmin ) {
		serverConfig.enablePhpMyAdmin = true;
	}

	const processDesc = await startProcess( processName, wordPressServerChildPath );
	try {
		await waitForReadyMessage( processDesc.pmId );
		await sendMessage(
			processDesc.pmId,
			processName,
			{
				topic: 'run-blueprint',
				data: { config: serverConfig },
			},
			{ logger }
		);
	} finally {
		// Always stop the process after blueprint is applied
		await stopProcess( processName );
	}
}

const wpCliResultSchema = z.object( {
	stdout: z.string(),
	stderr: z.string(),
	exitCode: z.number(),
} );

export async function sendWpCliCommand(
	siteId: string,
	args: string[]
): Promise< z.infer< typeof wpCliResultSchema > > {
	const processName = getProcessName( siteId );
	const runningProcess = await isProcessRunning( processName );

	if ( ! runningProcess ) {
		throw new Error( `WordPress server is not running` );
	}

	const result = await sendMessage( runningProcess.pmId, processName, {
		topic: 'wp-cli-command',
		data: { args },
	} );

	return wpCliResultSchema.parse( result );
}

/**
 * Subscribe to site server events
 *
 * Listens for process events and emits 'site-updated' when site status changes.
 * All process manager daemon events are mapped to 'site-updated'.
 *
 * @param handler - Callback invoked when a site event occurs
 * @returns Unsubscribe function to stop listening
 */
export async function subscribeSiteEvents(
	handler: ( data: { siteId: string; event: SITE_EVENTS; running: boolean } ) => void
): Promise< () => void > {
	const bus = await getDaemonBus();

	const messageHandler = ( message: DaemonBusEventMap[ 'process-message' ] ) => {
		const processName = message.process.name;
		if ( ! processName.startsWith( SITE_PROCESS_PREFIX ) ) {
			return;
		}

		if ( message.raw.topic === 'result' ) {
			const siteId = processName.replace( SITE_PROCESS_PREFIX, '' );
			// 'result' message means server started successfully
			handler( { siteId, event: SITE_EVENTS.UPDATED, running: true } );
		}
	};
	bus.on( 'process-message', messageHandler );

	const eventHandler = ( event: DaemonBusEventMap[ 'process-event' ] ) => {
		const processName = event.process.name;
		if ( ! processName.startsWith( SITE_PROCESS_PREFIX ) ) {
			return;
		}

		if ( event.event !== 'online' ) {
			const siteId = processName.replace( SITE_PROCESS_PREFIX, '' );
			handler( { siteId, event: SITE_EVENTS.UPDATED, running: false } );
		}
	};
	bus.on( 'process-event', eventHandler );

	return () => {
		bus.off( 'process-message', messageHandler );
		bus.off( 'process-event', eventHandler );
	};
}
