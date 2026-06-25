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
import { readLastLines } from '@studio/common/lib/fs-utils';
import { STUDIO_ERROR_LOG_FILENAME } from '@studio/common/lib/mu-plugins';
import { resolveNativePhpVersion } from '@studio/common/lib/php-binary-metadata';
import {
	getSiteRuntime,
	SITE_RUNTIME_NATIVE_PHP,
	SITE_RUNTIME_PLAYGROUND,
	type SiteRuntime,
} from '@studio/common/lib/site-runtime';
import { SiteCommandLoggerAction } from '@studio/common/logger-actions';
import { __ } from '@wordpress/i18n';
import { z } from 'zod';
import { SiteData } from 'cli/lib/cli-config/core';
import {
	isProcessRunning,
	startProcess,
	stopProcess,
	getDaemonBus,
	type DaemonBusEventMap,
	sendMessageToProcess,
} from 'cli/lib/daemon-client';
import { ensurePhpBinaryAvailable } from 'cli/lib/dependency-management/php-binary';
import { recordSiteRuntimeUsage } from 'cli/lib/site-runtime-stats';
import { ProcessDescription } from 'cli/lib/types/process-manager-ipc';
import {
	ServerConfig,
	ManagerMessagePayload,
	serverConfigSchema,
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

function getChildScriptPath( runtime: SiteRuntime ): string {
	switch ( runtime ) {
		case SITE_RUNTIME_NATIVE_PHP:
			return path.resolve( import.meta.dirname, 'php-server-child.mjs' );
		case SITE_RUNTIME_PLAYGROUND:
		default:
			return path.resolve( import.meta.dirname, 'playground-server-child.mjs' );
	}
}

function withSiteRuntime( processDescription: ProcessDescription ): ProcessDescription {
	return {
		...processDescription,
		runtime: processDescription.runtime ?? SITE_RUNTIME_PLAYGROUND,
	};
}

export async function isServerRunning( siteId: string ): Promise< ProcessDescription | undefined > {
	const processName = getProcessName( siteId );
	const runningProcess = await isProcessRunning( processName );
	return runningProcess ? withSiteRuntime( runningProcess ) : undefined;
}

function canReuseProcessForWpCli( processDescription: ProcessDescription ): boolean {
	return processDescription.runtime === SITE_RUNTIME_PLAYGROUND;
}

const startServerOptionsSchema = serverConfigSchema
	.pick( {
		wpVersion: true,
		siteLanguage: true,
		mounts: true,
		mountsBeforeInstall: true,
		wordpressInstallMode: true,
		skipSqliteSetup: true,
		useExactMountLayout: true,
		autoPrependFile: true,
		openBasedirAllowList: true,
	} )
	.extend( {
		blueprint: z.unknown().optional(),
		blueprintUri: z.string().optional(),
	} );

export type StartServerOptions = z.infer< typeof startServerOptionsSchema >;

function buildServerConfig(
	site: SiteData,
	runtime: SiteRuntime,
	options?: Partial< StartServerOptions & RunBlueprintOptions >
): ServerConfig {
	const serverConfig: ServerConfig = {
		siteId: site.id,
		sitePath: site.path,
		port: site.port,
		phpVersion:
			runtime === SITE_RUNTIME_NATIVE_PHP
				? resolveNativePhpVersion( site.phpVersion )
				: site.phpVersion,
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

	if ( options?.autoPrependFile ) {
		serverConfig.autoPrependFile = options.autoPrependFile;
	}

	if ( options?.openBasedirAllowList ) {
		serverConfig.openBasedirAllowList = options.openBasedirAllowList;
	}

	if ( site.fileAccess ) {
		serverConfig.fileAccess = site.fileAccess;
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
	logger: Logger< string >,
	runtime: SiteRuntime
): Promise< void > {
	if ( runtime === SITE_RUNTIME_NATIVE_PHP ) {
		const phpVersion = resolveNativePhpVersion( site.phpVersion );
		logger.reportStart(
			SiteCommandLoggerAction.ENSURE_PHP_BINARY,
			`Checking PHP ${ phpVersion } binary…`
		);
		await ensurePhpBinaryAvailable( phpVersion, ( downloaded, total ) => {
			const dl = ( downloaded / 1024 / 1024 ).toFixed( 1 );
			const tot = total ? ` / ${ ( total / 1024 / 1024 ).toFixed( 1 ) } MB` : '';
			logger.reportProgress( `Downloading PHP ${ phpVersion } (${ dl } MB${ tot })` );
		} );
	}
}

/**
 * Drops mounts of reprint state files whose host paths no longer exist.
 *
 * reprint's apply-runtime mounts importer state files (under /tmp/reprint
 * in the VFS) for the temporary remote-uploads proxy. Those files are
 * transient — a later sync can empty or remove them — so a persisted
 * start-options.json can reference paths that are gone, and mounting a
 * missing path crashes the server start with ENOENT. Critical site mounts
 * (core, wp-content, wp-config.php) are intentionally NOT filtered: if
 * those are missing, failing loudly is correct.
 */
function dropStaleReprintStateMounts( options: StartServerOptions ): StartServerOptions {
	const isStale = ( mount: { hostPath: string; vfsPath: string } ) =>
		mount.vfsPath.startsWith( '/tmp/reprint/' ) && ! fs.existsSync( mount.hostPath );

	return {
		...options,
		...( options.mountsBeforeInstall && {
			mountsBeforeInstall: options.mountsBeforeInstall.filter( ( m ) => ! isStale( m ) ),
		} ),
		...( options.mounts && {
			mounts: options.mounts.filter( ( m ) => ! isStale( m ) ),
		} ),
	};
}

/**
 * Start a WordPress server for a site via process manager daemon
 * 1. Start the process (via the process manager daemon)
 * 2. Wait for 'ready' message
 * 3. Send 'start-server' message with config
 * 4. Wait for response before resolving
 */
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
			options = startServerOptionsSchema.parse(
				JSON.parse( fs.readFileSync( optionsPath, 'utf-8' ) )
			);
			options = dropStaleReprintStateMounts( options );
		}
	}

	const runtime = getSiteRuntime( site );
	await ensurePhpBinaryAvailableIfNeeded( site, logger, runtime );

	const startMessage = options?.blueprint
		? __( 'Starting WordPress server and applying Blueprint…' )
		: __( 'Starting WordPress server…' );
	logger.reportStart( SiteCommandLoggerAction.START_SITE, startMessage );

	const wordPressServerChildPath = getChildScriptPath( runtime );
	const processName = getProcessName( site.id );
	const serverConfig = buildServerConfig( site, runtime, options );

	await clearStudioErrorLog( site );
	const phpErrorLogPath = path.join(
		site.path,
		'wp-content',
		site.enableDebugLog ? 'debug.log' : STUDIO_ERROR_LOG_FILENAME
	);
	const phpErrorLogSizeAtStart = await fileSize( phpErrorLogPath );

	const readyOrExit = await subscribeForReadyOrExit( processName );
	try {
		const processDesc = await startProcess( processName, wordPressServerChildPath, { runtime } );
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

		await recordSiteRuntimeUsage( site );

		return withSiteRuntime( processDesc );
	} catch ( error ) {
		throw await withCapturedPhpErrors( error, phpErrorLogPath, phpErrorLogSizeAtStart );
	} finally {
		readyOrExit.dispose();
	}
}

async function clearStudioErrorLog( site: SiteData ): Promise< void > {
	const logPath = path.join( site.path, 'wp-content', STUDIO_ERROR_LOG_FILENAME );
	await fs.promises.rm( logPath, { force: true } ).catch( () => undefined );
}

async function fileSize( filePath: string ): Promise< number > {
	try {
		return ( await fs.promises.stat( filePath ) ).size;
	} catch {
		return 0;
	}
}

const PHP_ERROR_TAIL_MAX_LINES = 50;

// Appends the PHP errors recorded during this start attempt to the failure, so
// users see why WordPress died instead of just "process exited..." (STU-1757).
async function withCapturedPhpErrors(
	error: unknown,
	logPath: string,
	sizeAtStart: number
): Promise< unknown > {
	if (
		! ( error instanceof Error ) ||
		error.name === 'AbortError' ||
		error.message === 'Operation aborted'
	) {
		return error;
	}

	// Only surface errors this attempt appended — debug.log isn't cleared and may
	// hold entries from previous runs.
	if ( ( await fileSize( logPath ) ) <= sizeAtStart ) {
		return error;
	}
	const lines = readLastLines( logPath, PHP_ERROR_TAIL_MAX_LINES );
	if ( lines?.length ) {
		error.message += `\nRecent PHP errors (${ logPath }):\n${ lines.join( '\n' ) }`;
	}

	return error;
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
					let errorMessage = 'WordPress server process exited unexpectedly';
					if ( event.stderrTail?.trim() ) {
						errorMessage += `\n${ event.stderrTail.trimEnd() }`;
					}
					reject( new Error( errorMessage ) );
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
	const runtime = getSiteRuntime( site );
	await ensurePhpBinaryAvailableIfNeeded( site, logger, runtime );
	logger.reportStart( SiteCommandLoggerAction.APPLY_BLUEPRINT, __( 'Applying Blueprint…' ) );

	const wordPressServerChildPath = getChildScriptPath( runtime );
	const processName = getProcessName( site.id );
	const serverConfig = buildServerConfig( site, runtime, options );

	const readyOrExit = await subscribeForReadyOrExit( processName );
	try {
		const processDesc = await startProcess( processName, wordPressServerChildPath, { runtime } );
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
	const runningProcess = await isServerRunning( siteId );

	if ( ! runningProcess ) {
		throw new Error( `WordPress server is not running` );
	}

	if ( ! canReuseProcessForWpCli( runningProcess ) ) {
		throw new Error( `Running WordPress server does not support WP-CLI commands` );
	}

	const result = await sendMessage( runningProcess.pmId, processName, {
		topic: 'wp-cli-command',
		data: { args },
	} );

	return wpCliResultSchema.parse( result );
}
