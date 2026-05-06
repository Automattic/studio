/**
 * WordPress Server Manager for Studio CLI
 *
 * Manages WordPress server processes via process manager daemon. Each site runs in a separate
 * process that spawns Playground CLI.
 */
import fs from 'fs';
import path from 'path';
import {
	PLAYGROUND_CLI_ACTIVITY_CHECK_INTERVAL,
	PLAYGROUND_CLI_INACTIVITY_TIMEOUT,
	PLAYGROUND_CLI_MAX_TIMEOUT,
} from '@studio/common/constants';
import { SiteCommandLoggerAction } from '@studio/common/logger-actions';
import { __ } from '@wordpress/i18n';
import { z } from 'zod';
import { SiteData, SiteRuntime } from 'cli/lib/cli-config/core';
import {
	isProcessRunning,
	startWordPressServerProcess,
	stopProcess,
	getDaemonBus,
	type DaemonBusEventMap,
	sendMessageToProcess,
} from 'cli/lib/daemon-client';
import { ensurePhpBinaryAvailable } from 'cli/lib/dependency-management/php-binary';
import { ProcessDescription } from 'cli/lib/types/process-manager-ipc';
import { ServerConfig, ManagerMessagePayload } from 'cli/lib/types/wordpress-server-ipc';
import { Logger } from 'cli/logger';
import { validatePhpVersion } from './utils';
import type { WordPressInstallMode } from '@wp-playground/wordpress';

export const SITE_PROCESS_PREFIX = 'studio-site-';

// Get an abort signal that's triggered on SIGINT/SIGTERM. This is useful for aborting and cleaning
// up async operations.
const abortController = new AbortController();
process.on( 'SIGINT', () => abortController.abort() );
process.on( 'SIGTERM', () => abortController.abort() );

export function getProcessName( siteId: string ): string {
	return `${ SITE_PROCESS_PREFIX }${ siteId }`;
}

function getWordPressServerRuntime( runtime: SiteRuntime | undefined ) {
	return runtime === 'native-php' ? 'native-php' : 'playground';
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
	siteLanguage?: string;
	mounts?: ServerConfig[ 'mounts' ];
	mountsBeforeInstall?: ServerConfig[ 'mountsBeforeInstall' ];
	wordpressInstallMode?: WordPressInstallMode;
	skipSqliteSetup?: boolean;
	useExactMountLayout?: boolean;
}

function buildServerConfig(
	site: SiteData,
	options?: Partial< StartServerOptions & RunBlueprintOptions >
): ServerConfig {
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

	if ( options?.siteLanguage ) {
		serverConfig.siteLanguage = options.siteLanguage;
	}

	if ( options?.blueprint && options.blueprintUri ) {
		serverConfig.blueprint = {
			contents: options.blueprint,
			uri: options.blueprintUri,
		};
	}

	if ( options?.mounts ) {
		serverConfig.mounts = options.mounts;
	}

	if ( options?.mountsBeforeInstall ) {
		serverConfig.mountsBeforeInstall = options.mountsBeforeInstall;
	}

	if ( options?.wordpressInstallMode ) {
		serverConfig.wordpressInstallMode = options.wordpressInstallMode;
	}

	if ( options?.skipSqliteSetup !== undefined ) {
		serverConfig.skipSqliteSetup = options.skipSqliteSetup;
	}

	if ( options?.useExactMountLayout ) {
		serverConfig.useExactMountLayout = true;
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

	return serverConfig;
}

async function ensurePhpBinaryAvailableIfNeeded(
	site: SiteData,
	logger: Logger< string >
): Promise< void > {
	if ( site.runtime === 'native-php' && site.phpVersion ) {
		logger.reportStart(
			SiteCommandLoggerAction.ENSURE_PHP_BINARY,
			`Checking PHP ${ site.phpVersion } binary…`
		);
		const phpVersion = validatePhpVersion( site.phpVersion );
		await ensurePhpBinaryAvailable( phpVersion, ( downloaded, total ) => {
			const dl = ( downloaded / 1024 / 1024 ).toFixed( 1 );
			const tot = total ? ` / ${ ( total / 1024 / 1024 ).toFixed( 1 ) } MB` : '';
			logger.reportProgress( `Downloading PHP ${ site.phpVersion } (${ dl } MB${ tot })` );
		} );
	}
}

export async function startWordPressServer(
	site: SiteData,
	logger: Logger< string >,
	options?: StartServerOptions
): Promise< ProcessDescription > {
	// For sites imported via `studio pull-reprint`, the pull command
	// persists the computed start options to start-options.json so the
	// daemon doesn't need to recompute them (which would spin up PHP
	// WASM to extract runtime.php constants from the imported site).
	if ( ! options && site.runtimeBlueprintPath ) {
		const optionsPath = path.join(
			path.dirname( site.runtimeBlueprintPath ),
			'start-options.json'
		);
		if ( fs.existsSync( optionsPath ) ) {
			options = JSON.parse( fs.readFileSync( optionsPath, 'utf-8' ) ) as StartServerOptions;
		}
	}

	await ensurePhpBinaryAvailableIfNeeded( site, logger );

	const startMessage = options?.blueprint
		? __( 'Starting WordPress server and applying Blueprint…' )
		: __( 'Starting WordPress server…' );
	logger.reportStart( SiteCommandLoggerAction.START_SITE, startMessage );

	const processName = getProcessName( site.id );
	const serverConfig = buildServerConfig( site, options );
	const processRuntime = getWordPressServerRuntime( site.runtime );

	const readyOrExit = await subscribeForReadyOrExit( processName );
	try {
		const processDesc = await startWordPressServerProcess( processName, processRuntime );
		await readyOrExit.waitFor( processDesc.pmId );
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
	} finally {
		readyOrExit.dispose();
	}
}

function buildChildExitedError( processName: string, stderrTail?: string ): Error {
	let message = `Server child process "${ processName }" exited before becoming ready.`;
	if ( stderrTail?.trim() ) {
		message += `\n${ stderrTail.trimEnd() }`;
	}
	return new Error( message );
}

/**
 * Attaches listeners to the daemon bus *before* the child process is started so we cannot miss
 * an early `ready` or `exit` event. Events that arrive before the caller knows the pmId are
 * buffered (filtered by processName) and replayed once `waitFor(pmId)` is called.
 * Must be disposed via `dispose()` when done.
 */
async function subscribeForReadyOrExit( processName: string ): Promise< {
	waitFor: ( pmId: number ) => Promise< void >;
	dispose: () => void;
} > {
	const bus = await getDaemonBus();

	const pendingReady: Array< DaemonBusEventMap[ 'process-message' ] > = [];
	const pendingExits: Array< DaemonBusEventMap[ 'process-event' ] > = [];
	let onReady: () => void = () => {};
	let onExit: ( stderrTail?: string ) => void = () => {};
	let waiting = false;

	const messageHandler = ( packet: DaemonBusEventMap[ 'process-message' ] ) => {
		if ( packet.process.name !== processName || packet.raw.topic !== 'ready' ) {
			return;
		}
		if ( waiting ) {
			onReady();
		} else {
			pendingReady.push( packet );
		}
	};
	const eventHandler = ( event: DaemonBusEventMap[ 'process-event' ] ) => {
		if ( event.process.name !== processName || event.event !== 'exit' ) {
			return;
		}
		if ( waiting ) {
			onExit( event.stderrTail );
		} else {
			pendingExits.push( event );
		}
	};

	bus.on( 'process-message', messageHandler );
	bus.on( 'process-event', eventHandler );

	const waitFor = ( pmId: number ): Promise< void > => {
		waiting = true;

		let timeoutId: NodeJS.Timeout;
		let abortListener: () => void;

		return new Promise< void >( ( resolve, reject ) => {
			timeoutId = setTimeout( () => {
				reject( new Error( 'Timeout waiting for ready message from server child process' ) );
			}, PLAYGROUND_CLI_INACTIVITY_TIMEOUT );
			abortListener = () => {
				reject( new Error( 'Operation aborted' ) );
			};

			onReady = () => resolve();
			onExit = ( stderrTail ) => reject( buildChildExitedError( processName, stderrTail ) );

			abortController.signal.addEventListener( 'abort', abortListener );

			// Replay any events we buffered before pmId was known.
			const bufferedExit = pendingExits.find( ( event ) => event.process.pm_id === pmId );
			if ( bufferedExit ) {
				onExit( bufferedExit.stderrTail );
				return;
			}
			const bufferedReady = pendingReady.find( ( packet ) => packet.process.pm_id === pmId );
			if ( bufferedReady ) {
				onReady();
			}
		} ).finally( () => {
			clearTimeout( timeoutId );
			abortController.signal.removeEventListener( 'abort', abortListener );
			// Release per-call handlers; the bus listeners stay until dispose().
			onReady = () => {};
			onExit = () => {};
			waiting = false;
		} );
	};

	const dispose = () => {
		bus.off( 'process-message', messageHandler );
		bus.off( 'process-event', eventHandler );
	};

	return { waitFor, dispose };
}

const messageActivityTrackers = new Map<
	string,
	{
		activityCheckIntervalId: NodeJS.Timeout;
	}
>();
const CHILD_EXIT_ERROR_GRACE_MS = 100;

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
	let exitRejectTimeoutId: NodeJS.Timeout | undefined;

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
					new Error(
						`Timeout waiting for response to message ${ message.topic }: ${ timeoutReason }`
					)
				);
			}
		}, PLAYGROUND_CLI_ACTIVITY_CHECK_INTERVAL );

		messageActivityTrackers.set( messageId, {
			activityCheckIntervalId,
		} );

		processEventHandler = ( event ) => {
			if ( event.process.name === processName && event.event === 'exit' ) {
				exitRejectTimeoutId = setTimeout( () => {
					reject( new Error( 'WordPress server process exited unexpectedly' ) );
				}, CHILD_EXIT_ERROR_GRACE_MS );
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
				if ( exitRejectTimeoutId ) {
					clearTimeout( exitRejectTimeoutId );
					exitRejectTimeoutId = undefined;
				}
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
				if ( exitRejectTimeoutId ) {
					clearTimeout( exitRejectTimeoutId );
					exitRejectTimeoutId = undefined;
				}
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
		if ( exitRejectTimeoutId ) {
			clearTimeout( exitRejectTimeoutId );
		}
	} );
}

const GRACEFUL_STOP_TIMEOUT = 5000;

export async function stopWordPressServer( siteId: string ): Promise< void > {
	const processName = getProcessName( siteId );
	const runningProcess = await isProcessRunning( processName );

	if ( ! runningProcess ) {
		return;
	}

	try {
		const bus = await getDaemonBus();
		let busExitEventListener: ( event: DaemonBusEventMap[ 'process-event' ] ) => void;

		const exitPromise = new Promise< void >( ( resolve ) => {
			busExitEventListener = ( event: DaemonBusEventMap[ 'process-event' ] ) => {
				if ( event.process.name === processName && event.event === 'exit' ) {
					resolve();
				}
			};

			bus.on( 'process-event', busExitEventListener );
		} ).finally( () => {
			bus.off( 'process-event', busExitEventListener );
		} );

		await sendMessage(
			runningProcess.pmId,
			processName,
			{ topic: 'stop-server', data: {} },
			{ maxTotalElapsedTime: GRACEFUL_STOP_TIMEOUT }
		);

		// Allow 5 seconds (arbitrary number) of cleanup time for the child process before throwing an
		// exception and telling the process manager to send a SIGKILL signal.
		await Promise.race( [
			exitPromise,
			new Promise( ( resolve, reject ) => setTimeout( reject, 5000 ) ),
		] );
	} catch {
		return stopProcess( processName );
	}
}

export interface RunBlueprintOptions {
	wpVersion?: string;
	blueprint: unknown;
	blueprintUri: string;
	siteLanguage?: string;
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
	await ensurePhpBinaryAvailableIfNeeded( site, logger );
	logger.reportStart( SiteCommandLoggerAction.APPLY_BLUEPRINT, __( 'Applying Blueprint…' ) );

	const processName = getProcessName( site.id );
	const serverConfig = buildServerConfig( site, options );
	const processRuntime = getWordPressServerRuntime( site.runtime );

	const readyOrExit = await subscribeForReadyOrExit( processName );
	try {
		const processDesc = await startWordPressServerProcess( processName, processRuntime );
		try {
			await readyOrExit.waitFor( processDesc.pmId );
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
	} finally {
		readyOrExit.dispose();
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
