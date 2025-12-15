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
	ManagerMessagePayload,
} from 'cli/lib/types/wordpress-server-ipc';
import { Logger } from 'cli/logger';

const SITE_PROCESS_PREFIX = 'studio-site-';

function getProcessName( siteId: string ): string {
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

	const env = {
		ELECTRON_RUN_AS_NODE: '1',
		STUDIO_WORDPRESS_SERVER_CONFIG: JSON.stringify( serverConfig ),
	};

	const processDesc = await startProcess( processName, wordPressServerChildPath, env );
	await waitForReadyMessage( processDesc.pmId );
	await sendMessage(
		processDesc.pmId,
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
		activityCheckIntervalId: NodeJS.Timeout;
	}
>();

interface SendMessageOptions {
	maxTotalElapsedTime?: number;
	logger?: Logger< string >;
}

async function sendMessage(
	pmId: number,
	message: ManagerMessagePayload,
	options: SendMessageOptions = {}
): Promise< unknown > {
	const { maxTotalElapsedTime = PLAYGROUND_CLI_MAX_TIMEOUT, logger } = options;
	const bus = await getPm2Bus();
	const messageId = nextMessageId++;
	let responseHandler: ( packet: unknown ) => void;

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
			} else if ( validPacket.raw.topic === 'error' ) {
				const error = new Error( validPacket.raw.errorMessage );
				if ( validPacket.raw.errorStack ) {
					error.stack = validPacket.raw.errorStack;
				}
				reject( error );
			} else if (
				validPacket.raw.topic === 'result' &&
				validPacket.raw.originalMessageId === messageId
			) {
				resolve( validPacket.raw.result );
			}
		};

		bus.on( 'process:msg', responseHandler );

		sendMessageToProcess( pmId, { ...message, messageId } ).catch( reject );
	} ).finally( () => {
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
				{ topic: 'stop-server' },
				{
					maxTotalElapsedTime: GRACEFUL_STOP_TIMEOUT,
				}
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

	if ( site.adminPassword ) {
		serverConfig.adminPassword = site.adminPassword;
	}

	if ( site.isWpAutoUpdating !== undefined ) {
		serverConfig.isWpAutoUpdating = site.isWpAutoUpdating;
	}

	if ( options.wpVersion ) {
		serverConfig.wpVersion = options.wpVersion;
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

	const result = await sendMessage( runningProcess.pmId, {
		topic: 'wp-cli-command',
		data: { args },
	} );

	return wpCliResultSchema.parse( result );
}

/**
 * Subscribe to site server events (online, exit, stop, restart)
 *
 * For 'online' events, we listen for the 'result' message from the WordPress server child
 * process, which indicates WordPress is fully ready (not just when PM2 process starts).
 *
 * For 'exit', 'stop', 'restart' events, we use PM2 process events.
 *
 * @param handler - Callback invoked when a site event occurs
 * @param options - Configuration options (e.g., debounceMs)
 * @returns Unsubscribe function to stop listening
 */
export async function subscribeSiteEvents(
	handler: ( data: { siteId: string; event: string } ) => void,
	options: { debounceMs?: number } = {}
): Promise< () => void > {
	const { debounceMs = 0 } = options;

	let debounceTimeout: NodeJS.Timeout | null = null;
	let pendingEvent: { siteId: string; event: string } | null = null;

	const invokeHandler = ( siteId: string, event: string ) => {
		if ( debounceMs > 0 ) {
			pendingEvent = { siteId, event };
			if ( debounceTimeout ) {
				clearTimeout( debounceTimeout );
			}
			debounceTimeout = setTimeout( () => {
				if ( pendingEvent ) {
					handler( pendingEvent );
					pendingEvent = null;
				}
			}, debounceMs );
		} else {
			handler( { siteId, event } );
		}
	};

	const unsubscribeMessages = await subscribeProcessMessages( ( { processName, topic } ) => {
		if ( ! processName.startsWith( SITE_PROCESS_PREFIX ) ) {
			return;
		}

		if ( topic === 'result' ) {
			const siteId = processName.replace( SITE_PROCESS_PREFIX, '' );
			invokeHandler( siteId, 'online' );
		}
	} );

	const unsubscribeEvents = await subscribeProcessEvents( ( { processName, event } ) => {
		if ( ! processName.startsWith( SITE_PROCESS_PREFIX ) ) {
			return;
		}

		if ( event !== 'online' ) {
			const siteId = processName.replace( SITE_PROCESS_PREFIX, '' );
			invokeHandler( siteId, event );
		}
	} );

	return () => {
		unsubscribeMessages();
		unsubscribeEvents();
		if ( debounceTimeout ) {
			clearTimeout( debounceTimeout );
		}
	};
}
