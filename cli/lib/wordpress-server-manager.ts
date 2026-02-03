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
import { SITE_EVENTS } from 'common/lib/site-events';
import { z } from 'zod';
import { SiteData, readAppdata } from 'cli/lib/appdata';
import {
	isProcessRunning,
	startProcess,
	stopProcess,
	getPm2Bus,
	sendMessageToProcess,
	subscribeProcessEvents,
	subscribeProcessMessages,
} from 'cli/lib/pm2-manager';
import { ProcessDescription } from 'cli/lib/types/pm2';
import {
	ServerConfig,
	childMessagePm2Schema,
	pm2ProcessEventSchema,
	ManagerMessagePayload,
} from 'cli/lib/types/wordpress-server-ipc';
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

async function isMultiWorkerEnabled() {
	try {
		const appdata = await readAppdata();
		return appdata.betaFeatures?.multiWorkerSupport ?? false;
	} catch {
		return false;
	}
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
	const wordPressServerChildPath = path.resolve( __dirname, 'wordpress-server-child.js' );
	const processName = getProcessName( site.id );

	const serverConfig: ServerConfig = {
		siteId: site.id,
		sitePath: site.path,
		port: site.port,
		phpVersion: site.phpVersion,
		siteTitle: site.name,
		enableMultiWorker: await isMultiWorkerEnabled(),
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

	const env = {
		ELECTRON_RUN_AS_NODE: '1',
		STUDIO_WORDPRESS_SERVER_CONFIG: JSON.stringify( serverConfig ),
	};

	const processDesc = await startProcess( processName, wordPressServerChildPath, env );
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
	const bus = await getPm2Bus();

	let timeoutId: NodeJS.Timeout;
	let readyHandler: ( packet: unknown ) => void;
	let abortListener: () => void;

	return new Promise< void >( ( resolve, reject ) => {
		timeoutId = setTimeout( () => {
			reject( new Error( 'Timeout waiting for ready message from WordPress server child' ) );
		}, PLAYGROUND_CLI_INACTIVITY_TIMEOUT );

		readyHandler = ( packet: unknown ) => {
			const result = childMessagePm2Schema.safeParse( packet );
			if ( ! result.success ) {
				return;
			}

			if ( result.data.process.pm_id === pmId && result.data.raw.topic === 'ready' ) {
				resolve();
			}
		};

		abortListener = () => {
			reject( new Error( 'Operation aborted' ) );
		};
		abortController.signal.addEventListener( 'abort', abortListener );

		bus.on( 'process:msg', readyHandler );
	} ).finally( () => {
		clearTimeout( timeoutId );
		abortController.signal.removeEventListener( 'abort', abortListener );
		bus.off( 'process:msg', readyHandler );
	} );
}

/**
 * Send message to PM2 process and wait for response with activity-based timeout
 * Implements activity-based timeout system:
 * - Tracks last activity timestamp
 * - Checks periodically for inactivity
 * - Has both inactivity timeout and max total timeout
 */
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

export async function sendMessage(
	pmId: number,
	processName: string,
	message: ManagerMessagePayload,
	options: SendMessageOptions = {}
): Promise< unknown > {
	const { maxTotalElapsedTime = PLAYGROUND_CLI_MAX_TIMEOUT, logger } = options;
	const bus = await getPm2Bus();
	const messageId = crypto.randomUUID();
	let responseHandler: ( packet: unknown ) => void;
	let processEventHandler: ( event: unknown ) => void;
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

		processEventHandler = ( event: unknown ) => {
			const result = pm2ProcessEventSchema.safeParse( event );
			if ( ! result.success ) {
				return;
			}

			if ( result.data.process.name === processName && result.data.event === 'exit' ) {
				reject( new Error( 'WordPress server process exited unexpectedly' ) );
			}
		};

		responseHandler = ( packet: unknown ) => {
			const validationResult = childMessagePm2Schema.safeParse( packet );
			if ( ! validationResult.success ) {
				// Don't reject on validation errors - other processes may send messages we don't handle
				return;
			}

			const validPacket = validationResult.data;

			if ( validPacket.process.pm_id !== pmId ) {
				return;
			}

			if ( validPacket.raw.topic === 'activity' ) {
				lastActivityTimestamp = Date.now();
			} else if ( validPacket.raw.topic === 'console-message' ) {
				lastActivityTimestamp = Date.now();
				logger?.reportProgress( validPacket.raw.message );
			} else if (
				validPacket.raw.topic === 'error' &&
				validPacket.raw.originalMessageId === messageId
			) {
				const error = new Error( validPacket.raw.errorMessage ) as Error & {
					cliArgs?: Record< string, unknown >;
				};
				if ( validPacket.raw.errorStack ) {
					error.stack = validPacket.raw.errorStack;
				}
				if ( validPacket.raw.cliArgs ) {
					error.cliArgs = validPacket.raw.cliArgs;
				}
				reject( error );
			} else if (
				validPacket.raw.topic === 'result' &&
				validPacket.raw.originalMessageId === messageId
			) {
				resolve( validPacket.raw.result );
			}
		};

		abortListener = () => {
			void sendMessageToProcess( pmId, { messageId, topic: 'abort', data: {} } );
			reject( new Error( 'Operation aborted' ) );
		};
		abortController.signal.addEventListener( 'abort', abortListener );

		bus.on( 'process:event', processEventHandler );
		bus.on( 'process:msg', responseHandler );

		sendMessageToProcess( pmId, { ...message, messageId } ).catch( reject );
	} ).finally( () => {
		abortController.signal.removeEventListener( 'abort', abortListener );
		bus.off( 'process:event', processEventHandler );
		bus.off( 'process:msg', responseHandler );

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
			// Graceful shutdown failed, PM2 delete will handle it
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
 * 1. Start the PM2 process
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
	const wordPressServerChildPath = path.resolve( __dirname, 'wordpress-server-child.js' );
	const processName = getProcessName( site.id );

	const serverConfig: ServerConfig = {
		siteId: site.id,
		sitePath: site.path,
		port: site.port,
		phpVersion: site.phpVersion,
		siteTitle: site.name,
		enableMultiWorker: await isMultiWorkerEnabled(),
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

	if ( site.isWpAutoUpdating !== undefined ) {
		serverConfig.isWpAutoUpdating = site.isWpAutoUpdating;
	}

	if ( options.wpVersion ) {
		serverConfig.wpVersion = options.wpVersion;
	}

	if ( site.enableXdebug ) {
		serverConfig.enableXdebug = true;
	}

	const env = {
		ELECTRON_RUN_AS_NODE: '1',
		STUDIO_WORDPRESS_SERVER_CONFIG: JSON.stringify( serverConfig ),
	};

	const processDesc = await startProcess( processName, wordPressServerChildPath, env );
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

const PM2_STATUS_EVENTS = [ 'exit', 'stop', 'restart', 'delete' ];

/**
 * Subscribe to site server events
 *
 * Listens for PM2 process events and emits 'site-updated' when site status changes.
 * All PM2 events (online, exit, stop, restart) are mapped to 'site-updated'.
 *
 * @param handler - Callback invoked when a site event occurs
 * @returns Unsubscribe function to stop listening
 */
export async function subscribeSiteEvents(
	handler: ( data: { siteId: string; event: SITE_EVENTS; running: boolean } ) => void
): Promise< () => void > {
	const unsubscribeMessages = await subscribeProcessMessages( ( { processName, topic } ) => {
		if ( ! processName.startsWith( SITE_PROCESS_PREFIX ) ) {
			return;
		}

		if ( topic === 'result' ) {
			const siteId = processName.replace( SITE_PROCESS_PREFIX, '' );
			// 'result' message means server started successfully
			handler( { siteId, event: SITE_EVENTS.UPDATED, running: true } );
		}
	} );

	const unsubscribeEvents = await subscribeProcessEvents( ( { processName, event } ) => {
		if ( ! processName.startsWith( SITE_PROCESS_PREFIX ) ) {
			return;
		}

		if ( PM2_STATUS_EVENTS.includes( event ) ) {
			const siteId = processName.replace( SITE_PROCESS_PREFIX, '' );
			// PM2 exit/stop/restart/delete events mean the server is not running
			handler( { siteId, event: SITE_EVENTS.UPDATED, running: false } );
		}
	} );

	return () => {
		unsubscribeMessages();
		unsubscribeEvents();
	};
}
