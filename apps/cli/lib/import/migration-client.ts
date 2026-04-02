/**
 * Migration Client – thin wrapper around importer.phar
 *
 * Downloads and runs the streaming-site-migration CLI tool.
 *
 * Prefer native PHP when available so the importer can use host tools
 * like external sort for large indexes. Fall back to a PHP WASM child
 * process when native PHP is unavailable.
 */
import { ChildProcess, fork, spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { getConfigDirectory } from '@studio/common/lib/well-known-paths';

const IMPORTER_PHAR_URL =
	'https://github.com/adamziel/streaming-site-migration/releases/latest/download/importer.phar';

export interface ImporterResult {
	stdout: string;
	stderr: string;
	exitCode: number;
}

export interface ImporterMount {
	hostPath: string;
	vfsPath: string;
}

export interface RunImporterOptions {
	mounts?: ImporterMount[];
	progressRoot?: string;
	progressLabel?: string;
	verboseCommands?: boolean;
}

interface NativeImporterCommand {
	command: string;
	args: string[];
}

interface ImporterProgressSnapshot {
	bytesReceived?: number;
	currentRequestBytesReceived?: number;
	downloadedBytes?: number;
	downloadedFiles?: number;
	event?: string;
	message?: string;
	phase?: string;
	rateBps?: number;
	statementsExecuted?: number;
	statementsTotal?: number;
	totalBytes?: number;
	totalFiles?: number;
}

function formatBytes( bytes: number ): string {
	if ( bytes < 1024 ) {
		return `${ bytes } B`;
	}

	if ( bytes < 1024 * 1024 ) {
		return `${ ( bytes / 1024 ).toFixed( 0 ) } KB`;
	}

	return `${ ( bytes / ( 1024 * 1024 ) ).toFixed( 1 ) } MB`;
}

function parseJsonlRecord( line: string ): unknown | null {
	try {
		return JSON.parse( line );
	} catch {
		return null;
	}
}

function readNumber( value: unknown ): number | undefined {
	return typeof value === 'number' && Number.isFinite( value ) ? value : undefined;
}

function readString( value: unknown ): string | undefined {
	return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function formatElapsedSeconds( elapsedSeconds: number ): string {
	const mins = Math.floor( elapsedSeconds / 60 );
	const secs = elapsedSeconds % 60;
	return mins > 0 ? `${ mins }m ${ secs }s` : `${ secs }s`;
}

function mapImporterPhase( phase: string | undefined ): string | undefined {
	switch ( phase ) {
		case 'index':
			return 'indexing remote files';
		case 'diff':
			return 'preparing download list';
		case 'fetch':
			return 'streaming';
		case 'fetch-skipped':
			return 'streaming';
		case 'db-index':
			return 'indexing tables';
		case 'sql':
			return 'downloading';
		case 'db-apply':
			return 'applying';
		default:
			return phase;
	}
}

function getDefaultPhaseForCommand( command: string | undefined ): string | undefined {
	switch ( command ) {
		case 'files-sync':
			return 'starting';
		case 'db-sync':
			return 'starting';
		case 'db-apply':
			return 'starting';
		default:
			return undefined;
	}
}

function shortenImporterPath( value: string | undefined ): string | undefined {
	if ( ! value ) {
		return undefined;
	}

	const segments = value.split( '/' ).filter( Boolean );
	if ( segments.length <= 3 ) {
		return value;
	}

	return `.../${ segments.slice( -3 ).join( '/' ) }`;
}

export function updateImporterProgressSnapshot(
	record: unknown,
	snapshot: ImporterProgressSnapshot = {}
): ImporterProgressSnapshot | null {
	if ( ! record || typeof record !== 'object' || Array.isArray( record ) ) {
		return null;
	}

	const object = record as Record< string, unknown >;

	if ( 'http_code' in object || 'protocol_version' in object ) {
		return null;
	}

	const nextSnapshot: ImporterProgressSnapshot = { ...snapshot };
	const type = readString( object.type );
	if ( type ) {
		nextSnapshot.event = type;
	}

	const phase = mapImporterPhase( readString( object.phase ) );
	if ( phase ) {
		nextSnapshot.phase = phase;
	}

	if ( type === 'lifecycle' ) {
		nextSnapshot.phase = mapImporterPhase( readString( object.stage ) ) ?? nextSnapshot.phase;
		const event = readString( object.event );
		if ( event ) {
			nextSnapshot.message = event;
		}
		return nextSnapshot;
	}

	if ( type === 'symlink_follow' ) {
		nextSnapshot.phase = nextSnapshot.phase ?? 'indexing remote files';
		nextSnapshot.message = `following symlink ${ shortenImporterPath(
			readString( object.directory )
		) }`;
		return nextSnapshot;
	}

	if ( type === 'symlink_follow_rejected' ) {
		nextSnapshot.phase = nextSnapshot.phase ?? 'indexing remote files';
		nextSnapshot.message = `skipped symlink ${ shortenImporterPath(
			readString( object.directory )
		) }`;
		return nextSnapshot;
	}

	const debug = readString( object.debug );
	if ( debug ) {
		nextSnapshot.message = debug;
	}

	const status = readString( object.status );
	if ( status === 'starting' ) {
		nextSnapshot.message = 'starting';
	} else if ( status === 'complete' && nextSnapshot.phase ) {
		nextSnapshot.message = 'complete';
	} else if ( status && ! nextSnapshot.message ) {
		nextSnapshot.message = status;
	}

	const downloadedFiles = readNumber( object.downloaded_files ) ?? readNumber( object.files_done );
	const totalFiles = readNumber( object.total_files ) ?? readNumber( object.files_total );
	const downloadedBytes = readNumber( object.downloaded_bytes ) ?? readNumber( object.bytes_done );
	const totalBytes = readNumber( object.total_bytes ) ?? readNumber( object.bytes_total );
	const bytesReceived = readNumber( object.bytes_received );
	const rateBps = readNumber( object.rate_bps );
	const statementsExecuted = readNumber( object.statements_executed );
	const statementsTotal = readNumber( object.statements_total );

	if ( downloadedFiles !== undefined ) {
		nextSnapshot.downloadedFiles = downloadedFiles;
	}
	if ( totalFiles !== undefined ) {
		nextSnapshot.totalFiles = totalFiles;
	}
	if ( downloadedBytes !== undefined ) {
		nextSnapshot.downloadedBytes = downloadedBytes;
	}
	if ( totalBytes !== undefined ) {
		nextSnapshot.totalBytes = totalBytes;
	}
	if ( bytesReceived !== undefined ) {
		const previousRequestBytes = snapshot.currentRequestBytesReceived ?? 0;
		const previousCumulativeBytes = snapshot.bytesReceived ?? 0;
		const requestRestarted = bytesReceived < previousRequestBytes;
		const byteBase = requestRestarted
			? previousCumulativeBytes
			: previousCumulativeBytes - previousRequestBytes;

		nextSnapshot.currentRequestBytesReceived = bytesReceived;
		nextSnapshot.bytesReceived = byteBase + bytesReceived;
	}
	if ( rateBps !== undefined ) {
		nextSnapshot.rateBps = rateBps;
	}
	if ( statementsExecuted !== undefined ) {
		nextSnapshot.statementsExecuted = statementsExecuted;
	}
	if ( statementsTotal !== undefined ) {
		nextSnapshot.statementsTotal = statementsTotal;
	}

	const message =
		readString( object.progress ) ??
		readString( object.message ) ??
		readString( object.event ) ??
		readString( object.type );

	if ( message && ! debug ) {
		nextSnapshot.message = message;
	}

	return nextSnapshot;
}

export function formatImporterProgressSnapshot(
	snapshot: ImporterProgressSnapshot,
	progressLabel: string,
	elapsedSeconds: number
): string | null {
	const elapsed = formatElapsedSeconds( elapsedSeconds );
	const segments = [ progressLabel ];

	if ( snapshot.phase ) {
		segments.push( snapshot.phase );
	}

	if ( snapshot.downloadedFiles !== undefined && snapshot.totalFiles !== undefined ) {
		segments.push( `${ snapshot.downloadedFiles }/${ snapshot.totalFiles } files` );
	} else if ( snapshot.downloadedFiles !== undefined ) {
		segments.push( `${ snapshot.downloadedFiles } files` );
	} else if ( snapshot.totalFiles !== undefined ) {
		segments.push( `${ snapshot.totalFiles } files` );
	}

	if ( snapshot.downloadedBytes !== undefined && snapshot.totalBytes !== undefined ) {
		segments.push(
			`${ formatBytes( snapshot.downloadedBytes ) }/${ formatBytes( snapshot.totalBytes ) }`
		);
	} else if ( snapshot.downloadedBytes !== undefined ) {
		segments.push( `${ formatBytes( snapshot.downloadedBytes ) } downloaded` );
	} else if ( snapshot.bytesReceived !== undefined ) {
		segments.push( `${ formatBytes( snapshot.bytesReceived ) } received` );
		if ( snapshot.rateBps !== undefined ) {
			segments.push( `${ formatBytes( snapshot.rateBps ) }/s` );
		}
	}

	if ( snapshot.statementsExecuted !== undefined || snapshot.statementsTotal !== undefined ) {
		if ( snapshot.statementsExecuted !== undefined && snapshot.statementsTotal !== undefined ) {
			segments.push( `${ snapshot.statementsExecuted }/${ snapshot.statementsTotal } statements` );
		} else if ( snapshot.statementsExecuted !== undefined ) {
			segments.push( `${ snapshot.statementsExecuted } statements` );
		}
	}

	if ( snapshot.message && snapshot.message !== snapshot.phase ) {
		segments.push( snapshot.message );
	}

	if ( segments.length === 1 ) {
		return null;
	}

	segments.push( elapsed );
	return segments.join( ' · ' );
}

export function formatImporterJsonlProgress(
	record: unknown,
	progressLabel: string,
	elapsedSeconds: number
): string | null {
	const snapshot = updateImporterProgressSnapshot( record );
	if ( ! snapshot ) {
		return null;
	}

	return formatImporterProgressSnapshot( snapshot, progressLabel, elapsedSeconds );
}

export async function downloadLatestImporterPhar(): Promise< string > {
	const pharPath = path.join( getConfigDirectory(), 'importer.phar' );
	const response = await fetch( IMPORTER_PHAR_URL, { redirect: 'follow' } );

	if ( ! response.ok ) {
		throw new Error( `Failed to download importer.phar: ${ response.status }` );
	}

	const buffer = Buffer.from( await response.arrayBuffer() );
	fs.writeFileSync( pharPath, buffer );
	return pharPath;
}

async function ensureImporterPhar(): Promise< string > {
	return downloadLatestImporterPhar();
}

function getImporterChildPath(): string {
	for ( const filename of [ 'importer-child.mjs', 'importer-child.js' ] ) {
		const candidate = path.resolve( import.meta.dirname, filename );
		if ( fs.existsSync( candidate ) ) {
			return candidate;
		}
	}

	return path.resolve( import.meta.dirname, 'importer-child.mjs' );
}

function getNativePhpCommand(): string | null {
	const candidates = [ process.env.STUDIO_IMPORTER_PHP, 'php' ].filter(
		( value ): value is string => typeof value === 'string' && value.length > 0
	);

	for ( const candidate of candidates ) {
		const result = spawnSync( candidate, [ '-v' ], {
			stdio: 'ignore',
		} );
		if ( result.status === 0 ) {
			return candidate;
		}
	}

	return null;
}

function rewriteImporterPathValue(
	value: string,
	pathMappings: Array< readonly [ string, string ] >
): string {
	for ( const [ virtualPath, hostPath ] of pathMappings ) {
		if ( value === virtualPath ) {
			return hostPath;
		}

		if ( value.startsWith( `${ virtualPath }/` ) ) {
			return path.join( hostPath, value.slice( virtualPath.length + 1 ) );
		}
	}

	return value;
}

export function resolveNativeImporterInvocation(
	pharPath: string,
	stateDir: string,
	docroot: string,
	tmpDir: string,
	args: string[],
	mounts: ImporterMount[] = []
): NativeImporterCommand {
	const phpCommand = getNativePhpCommand();
	if ( ! phpCommand ) {
		throw new Error( 'No native PHP executable was found in PATH.' );
	}

	const pathMappings = [
		[ '/state', stateDir ] as const,
		[ '/docroot', docroot ] as const,
		[ '/tmp', tmpDir ] as const,
		...mounts
			.map( ( mount ) => [ mount.vfsPath, mount.hostPath ] as const )
			.sort( ( left, right ) => right[ 0 ].length - left[ 0 ].length ),
	];

	const resolvedArgs = args.map( ( arg ) => {
		const equalsIndex = arg.indexOf( '=' );
		if ( equalsIndex === -1 ) {
			return rewriteImporterPathValue( arg, pathMappings );
		}

		const option = arg.slice( 0, equalsIndex + 1 );
		const value = arg.slice( equalsIndex + 1 );
		return `${ option }${ rewriteImporterPathValue( value, pathMappings ) }`;
	} );

	return {
		command: phpCommand,
		args: [ pharPath, ...resolvedArgs ],
	};
}

function createProgressReporter(
	progressLabel: string,
	defaultPhase: string | undefined,
	startTime: number,
	onProgress?: ( output: string ) => void
) {
	let stdoutLineBuffer = '';
	let progressSnapshot: ImporterProgressSnapshot | null = defaultPhase
		? { phase: defaultPhase }
		: null;
	let lastRenderedSecond = -1;

	const reportLines = ( lines: string[] ) => {
		if ( ! onProgress ) {
			return;
		}

		for ( const line of lines ) {
			const record = parseJsonlRecord( line );
			const nextSnapshot = updateImporterProgressSnapshot( record, progressSnapshot ?? undefined );
			if ( nextSnapshot ) {
				progressSnapshot = nextSnapshot;
			}
			const progressMessage =
				progressSnapshot &&
				formatImporterProgressSnapshot(
					progressSnapshot,
					progressLabel,
					Math.floor( ( Date.now() - startTime ) / 1000 )
				);

			if ( progressMessage ) {
				onProgress( progressMessage );
			}
		}
	};

	const pushStdoutChunk = ( chunk: string ) => {
		stdoutLineBuffer += chunk;
		const lines = stdoutLineBuffer.split( '\n' );
		stdoutLineBuffer = lines.pop() ?? '';
		reportLines( lines );
	};

	const flush = () => {
		if ( stdoutLineBuffer.trim().length > 0 ) {
			reportLines( [ stdoutLineBuffer.trim() ] );
		}
	};

	const progressTicker =
		onProgress &&
		setInterval( () => {
			if ( ! progressSnapshot ) {
				return;
			}

			const elapsedSeconds = Math.floor( ( Date.now() - startTime ) / 1000 );
			if ( elapsedSeconds === lastRenderedSecond ) {
				return;
			}

			const progressMessage = formatImporterProgressSnapshot(
				progressSnapshot,
				progressLabel,
				elapsedSeconds
			);
			if ( progressMessage ) {
				lastRenderedSecond = elapsedSeconds;
				onProgress( progressMessage );
			}
		}, 250 );

	return {
		pushStdoutChunk,
		flush,
		cleanup() {
			if ( progressTicker ) {
				clearInterval( progressTicker );
			}
		},
	};
}

type ProgressReporter = ReturnType< typeof createProgressReporter >;

async function runImporterCommandWithNativePhp(
	pharPath: string,
	stateDir: string,
	docroot: string,
	tmpDir: string,
	args: string[],
	options: RunImporterOptions,
	progressReporter: ProgressReporter
): Promise< ImporterResult > {
	const command = resolveNativeImporterInvocation(
		pharPath,
		stateDir,
		docroot,
		tmpDir,
		args,
		options.mounts ?? []
	);

	if ( options.verboseCommands ) {
		console.error( `[importer] ${ [ command.command, ...command.args ].join( ' ' ) }` );
	}

	return await new Promise< ImporterResult >( ( resolve, reject ) => {
		const child = spawn( command.command, command.args, {
			stdio: [ 'ignore', 'pipe', 'pipe' ],
		} );
		const stdoutChunks: string[] = [];
		const stderrChunks: string[] = [];

		const sigintHandler = () => {
			child.kill( 'SIGKILL' );
			process.exit( 130 );
		};
		process.on( 'SIGINT', sigintHandler );

		const cleanup = () => {
			process.removeListener( 'SIGINT', sigintHandler );
		};

		child.stdout?.on( 'data', ( chunk: Buffer ) => {
			const text = chunk.toString();
			stdoutChunks.push( text );
			progressReporter.pushStdoutChunk( text );
		} );

		child.stderr?.on( 'data', ( chunk: Buffer ) => {
			stderrChunks.push( chunk.toString() );
		} );

		child.on( 'error', ( error ) => {
			cleanup();
			reject( error );
		} );

		child.on( 'exit', ( exitCode ) => {
			cleanup();
			progressReporter.flush();
			resolve( {
				stdout: stdoutChunks.join( '' ),
				stderr: stderrChunks.join( '' ),
				exitCode: exitCode ?? 1,
			} );
		} );
	} );
}

async function runImporterCommandWithWasmChild(
	pharPath: string,
	stateDir: string,
	docroot: string,
	tmpDir: string,
	args: string[],
	options: RunImporterOptions,
	progressReporter: ProgressReporter
): Promise< ImporterResult > {
	const childPath = getImporterChildPath();

	if ( options.verboseCommands ) {
		const mountsSuffix =
			options.mounts && options.mounts.length > 0
				? ` mounts=${ options.mounts
						.map( ( mount ) => `${ mount.hostPath }:${ mount.vfsPath }` )
						.join( ',' ) }`
				: '';
		console.error( `[importer] php importer.phar ${ args.join( ' ' ) }${ mountsSuffix }` );
	}

	return await new Promise< ImporterResult >( ( resolve, reject ) => {
		const child: ChildProcess = fork( childPath, [], {
			stdio: [ 'pipe', 'pipe', 'pipe', 'ipc' ],
		} );
		let settled = false;
		const childStderrChunks: string[] = [];

		child.stderr?.on( 'data', ( chunk: Buffer ) => {
			childStderrChunks.push( chunk.toString() );
		} );

		const sigintHandler = () => {
			child.kill( 'SIGKILL' );
			process.exit( 130 );
		};
		process.on( 'SIGINT', sigintHandler );

		const cleanup = () => {
			process.removeListener( 'SIGINT', sigintHandler );
		};

		child.on(
			'message',
			( msg: {
				type: string;
				stdout?: string;
				stderr?: string;
				chunk?: string;
				exitCode?: number;
				message?: string;
			} ) => {
				if ( msg.type === 'stdout' ) {
					progressReporter.pushStdoutChunk( msg.chunk || '' );
					return;
				}

				if ( msg.type === 'stderr' ) {
					return;
				}

				cleanup();
				settled = true;

				if ( msg.type === 'result' ) {
					progressReporter.flush();
					resolve( {
						stdout: msg.stdout || '',
						stderr: msg.stderr || '',
						exitCode: msg.exitCode ?? 1,
					} );
					return;
				}

				if ( msg.type === 'error' ) {
					reject( new Error( msg.message || 'importer child process error' ) );
				}
			}
		);

		child.on( 'error', ( err ) => {
			cleanup();
			if ( ! settled ) {
				settled = true;
				reject( err );
			}
		} );

		child.on( 'exit', ( code ) => {
			cleanup();
			if ( ! settled ) {
				settled = true;
				const childStderr = childStderrChunks.join( '' ).trim();
				const details = childStderr
					? `Child process stderr:\n${ childStderr }`
					: 'No error details available';
				reject( new Error( `importer child process exited with code ${ code }. ${ details }` ) );
			}
		} );

		child.send( {
			type: 'run',
			pharPath,
			stateDir,
			docroot,
			tmpDir,
			args,
			mounts: options.mounts ?? [],
		} );
	} );
}

export async function runImporterCommandUntilComplete(
	stateDir: string,
	docroot: string,
	args: string[],
	onProgress?: ( output: string ) => void,
	options: RunImporterOptions = {}
): Promise< ImporterResult > {
	const pharPath = await ensureImporterPhar();
	const tmpDir = path.join( path.dirname( stateDir ), 'tmp' );
	fs.mkdirSync( tmpDir, { recursive: true } );

	const progressLabel = options.progressLabel ?? args[ 0 ] ?? 'Importing';
	const defaultPhase = getDefaultPhaseForCommand( args[ 0 ] );
	const startTime = Date.now();
	const nativePhpCommand = getNativePhpCommand();

	// Create the progress reporter once so cumulative counters (bytes received,
	// file counts) survive across importer restarts (exit code 2).
	const progressReporter = createProgressReporter(
		progressLabel,
		defaultPhase,
		startTime,
		onProgress
	);

	let lastResult: ImporterResult | undefined;

	try {
		do {
			if ( nativePhpCommand ) {
				lastResult = await runImporterCommandWithNativePhp(
					pharPath,
					stateDir,
					docroot,
					tmpDir,
					args,
					options,
					progressReporter
				);
			} else {
				lastResult = await runImporterCommandWithWasmChild(
					pharPath,
					stateDir,
					docroot,
					tmpDir,
					args,
					options,
					progressReporter
				);
			}

			if ( lastResult.exitCode === 1 ) {
				const details = [ lastResult.stderr, lastResult.stdout ].filter( Boolean ).join( '\n' );
				throw new Error( details || 'importer.phar failed' );
			}
		} while ( lastResult.exitCode === 2 );

		return lastResult;
	} finally {
		progressReporter.cleanup();
	}
}
