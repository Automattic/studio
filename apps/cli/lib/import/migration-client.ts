/**
 * Migration Client – thin wrapper around reprint.phar
 *
 * Runs the bundled reprint.phar streaming-site-migration CLI tool
 * via a PHP WASM child process. reprint's index sorter falls back
 * to an in-memory usort() when exec() is unavailable, which handles
 * sites with up to hundreds of thousands of files comfortably within
 * the 512 MB WASM memory limit.
 */
import { ChildProcess, fork } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

function getBundledReprintPhar(): string {
	const candidate = path.join( import.meta.dirname, 'reprint.phar' );
	if ( ! fs.existsSync( candidate ) ) {
		throw new Error( `Bundled reprint.phar not found at ${ candidate }` );
	}
	return candidate;
}

export interface ReprintProcessResult {
	stdout: string;
	stderr: string;
	exitCode: number;
}

export interface ReprintMount {
	hostPath: string;
	vfsPath: string;
}

export interface RunReprintOptions {
	mounts?: ReprintMount[];
	progressRoot?: string;
	progressLabel?: string;
	verboseCommands?: boolean;
}

interface ReprintProgressSnapshot {
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

const SQL_ANALYZING_STALL_MS = 5000;

interface ReprintIndexUpdate {
	delete: boolean;
	pathKey: string;
}

function getTrackedFileVersion( filePath: string ): string | null {
	try {
		const stats = fs.statSync( filePath );
		return `${ stats.dev }:${ stats.ino }:${ stats.size }:${ stats.mtimeMs }`;
	} catch {
		return null;
	}
}

function getTrackedFileIdentity( filePath: string ): { identity: string; size: number } | null {
	try {
		const stats = fs.statSync( filePath );
		return {
			identity: `${ stats.dev }:${ stats.ino }`,
			size: stats.size,
		};
	} catch {
		return null;
	}
}

function readFileSliceUtf8( filePath: string, start: number, length: number ): string {
	if ( length <= 0 ) {
		return '';
	}

	const fileDescriptor = fs.openSync( filePath, 'r' );

	try {
		const buffer = Buffer.alloc( length );
		const bytesRead = fs.readSync( fileDescriptor, buffer, 0, length, start );
		return buffer.subarray( 0, bytesRead ).toString( 'utf8' );
	} finally {
		fs.closeSync( fileDescriptor );
	}
}

function readPathKeyFromRecord( line: string ): string | undefined {
	const record = parseJsonlRecord( line );
	if ( ! record || typeof record !== 'object' || Array.isArray( record ) ) {
		return undefined;
	}

	return readString( ( record as Record< string, unknown > ).path );
}

function readReprintIndexUpdate( line: string ): ReprintIndexUpdate | null {
	const record = parseJsonlRecord( line );
	if ( ! record || typeof record !== 'object' || Array.isArray( record ) ) {
		return null;
	}

	const object = record as Record< string, unknown >;
	const pathKey = readString( object.path );
	const op = readString( object.op );
	if ( ! pathKey || ( op !== 'F' && op !== 'D' ) ) {
		return null;
	}

	return {
		delete: op === 'D',
		pathKey,
	};
}

export function applyIndexedEntryProgress(
	snapshot: ReprintProgressSnapshot,
	indexedEntries: number
): ReprintProgressSnapshot {
	const exactDownloadedFiles =
		snapshot.totalFiles !== undefined
			? Math.min( indexedEntries, snapshot.totalFiles )
			: indexedEntries;
	if ( exactDownloadedFiles <= ( snapshot.downloadedFiles ?? 0 ) ) {
		return snapshot;
	}

	return {
		...snapshot,
		downloadedFiles: exactDownloadedFiles,
	};
}

export class ReprintIndexProgressTracker {
	private readonly indexFilePath: string;
	private readonly updatesFilePath: string;
	private baselinePathKeys = new Set< string >();
	private exactIndexedEntries = 0;
	private indexFileVersion: string | null = null;
	private pendingPathStates = new Map< string, boolean >();
	private updatesFileIdentity: string | null = null;
	private updatesFileOffset = 0;
	private updatesLineRemainder = '';

	constructor( progressRoot: string ) {
		this.indexFilePath = path.join( progressRoot, '.import-index.jsonl' );
		this.updatesFilePath = path.join( progressRoot, '.import-index-updates.jsonl' );
	}

	getIndexedEntries(): number {
		this.refreshBaseIndex();

		const updatesStats = getTrackedFileIdentity( this.updatesFilePath );
		if ( ! updatesStats ) {
			this.updatesFileIdentity = null;
			this.updatesFileOffset = 0;
			this.updatesLineRemainder = '';
			return this.exactIndexedEntries;
		}

		if (
			updatesStats.identity !== this.updatesFileIdentity ||
			updatesStats.size < this.updatesFileOffset
		) {
			this.rebuildBaseIndex();
		}

		if ( updatesStats.size > this.updatesFileOffset ) {
			const appendedText = readFileSliceUtf8(
				this.updatesFilePath,
				this.updatesFileOffset,
				updatesStats.size - this.updatesFileOffset
			);
			this.updatesFileOffset = updatesStats.size;
			this.applyUpdateChunk( appendedText );
		}

		this.updatesFileIdentity = updatesStats.identity;
		return this.exactIndexedEntries;
	}

	private refreshBaseIndex(): void {
		const nextVersion = getTrackedFileVersion( this.indexFilePath );
		if ( nextVersion !== this.indexFileVersion ) {
			this.rebuildBaseIndex();
		}
	}

	private rebuildBaseIndex(): void {
		this.indexFileVersion = getTrackedFileVersion( this.indexFilePath );
		this.baselinePathKeys.clear();
		this.pendingPathStates.clear();
		this.updatesFileIdentity = null;
		this.updatesFileOffset = 0;
		this.updatesLineRemainder = '';

		let fileDescriptor: number | undefined;
		try {
			fileDescriptor = fs.openSync( this.indexFilePath, 'r' );
		} catch {
			// Ignore missing or unreadable index files — reprint creates them lazily.
			this.exactIndexedEntries = 0;
			return;
		}

		// Read the index file in chunks instead of loading the entire file
		// into memory.  For sites with tens of thousands of files, the
		// index can be several megabytes of JSON-L.
		try {
			const chunkSize = 64 * 1024;
			const buffer = Buffer.alloc( chunkSize );
			let remainder = '';
			let bytesRead: number;

			do {
				bytesRead = fs.readSync( fileDescriptor, buffer, 0, chunkSize, null );
				const text = remainder + buffer.subarray( 0, bytesRead ).toString( 'utf8' );
				const lines = text.split( '\n' );
				remainder = lines.pop() ?? '';

				for ( const line of lines ) {
					const pathKey = readPathKeyFromRecord( line );
					if ( pathKey ) {
						this.baselinePathKeys.add( pathKey );
					}
				}
			} while ( bytesRead === chunkSize );

			if ( remainder ) {
				const pathKey = readPathKeyFromRecord( remainder );
				if ( pathKey ) {
					this.baselinePathKeys.add( pathKey );
				}
			}
		} finally {
			fs.closeSync( fileDescriptor );
		}

		this.exactIndexedEntries = this.baselinePathKeys.size;
	}

	private applyUpdateChunk( chunk: string ): void {
		if ( chunk.length === 0 ) {
			return;
		}

		const combinedChunk = this.updatesLineRemainder + chunk;
		const lines = combinedChunk.split( '\n' );
		this.updatesLineRemainder = lines.pop() ?? '';

		for ( const line of lines ) {
			const update = readReprintIndexUpdate( line );
			if ( update ) {
				this.applyUpdate( update );
			}
		}
	}

	private applyUpdate( update: ReprintIndexUpdate ): void {
		const previousExists = this.pendingPathStates.has( update.pathKey )
			? this.pendingPathStates.get( update.pathKey )!
			: this.baselinePathKeys.has( update.pathKey );
		const nextExists = ! update.delete;

		if ( previousExists !== nextExists ) {
			this.exactIndexedEntries += nextExists ? 1 : -1;
		}

		this.pendingPathStates.set( update.pathKey, nextExists );
	}
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
	if ( typeof value === 'number' ) {
		return Number.isFinite( value ) ? value : undefined;
	}

	// reprint's PHP json_encode may emit numeric values as strings.
	if ( typeof value === 'string' && value.length > 0 ) {
		const parsed = Number( value );
		return Number.isFinite( parsed ) ? parsed : undefined;
	}

	return undefined;
}

function readString( value: unknown ): string | undefined {
	return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function formatElapsedSeconds( elapsedSeconds: number ): string {
	const mins = Math.floor( elapsedSeconds / 60 );
	const secs = elapsedSeconds % 60;
	return mins > 0 ? `${ mins }m ${ secs }s` : `${ secs }s`;
}

function mapReprintPhase( phase: string | undefined ): string | undefined {
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

function shortenReprintPath( value: string | undefined ): string | undefined {
	if ( ! value ) {
		return undefined;
	}

	const segments = value.split( '/' ).filter( Boolean );
	if ( segments.length <= 3 ) {
		return value;
	}

	return `.../${ segments.slice( -3 ).join( '/' ) }`;
}

export function updateReprintProgressSnapshot(
	record: unknown,
	snapshot: ReprintProgressSnapshot = {}
): ReprintProgressSnapshot | null {
	if ( ! record || typeof record !== 'object' || Array.isArray( record ) ) {
		return null;
	}

	const object = record as Record< string, unknown >;

	if ( 'http_code' in object || 'protocol_version' in object ) {
		return null;
	}

	const nextSnapshot: ReprintProgressSnapshot = { ...snapshot };
	const type = readString( object.type );
	if ( type ) {
		nextSnapshot.event = type;
	}

	const phase = mapReprintPhase( readString( object.phase ) );
	if ( phase ) {
		nextSnapshot.phase = phase;
	}

	if ( type === 'lifecycle' ) {
		nextSnapshot.phase = mapReprintPhase( readString( object.stage ) ) ?? nextSnapshot.phase;
		// Don't overwrite the last meaningful message with "resuming" — the user
		// doesn't need to know about internal reprint restarts.
		const event = readString( object.event );
		if ( event && event !== 'resuming' ) {
			nextSnapshot.message = event;
		}
		return nextSnapshot;
	}

	if ( type === 'symlink_follow' ) {
		nextSnapshot.phase = 'indexing remote files';
		nextSnapshot.message = `following symlink ${ shortenReprintPath(
			readString( object.directory )
		) }`;
		return nextSnapshot;
	}

	if ( type === 'symlink_follow_rejected' ) {
		nextSnapshot.phase = 'indexing remote files';
		nextSnapshot.message = `skipped symlink ${ shortenReprintPath(
			readString( object.directory )
		) }`;
		return nextSnapshot;
	}

	// Debug messages ("Waiting for server response…") are internal — don't
	// surface them as the user-visible progress message.
	const debug = readString( object.debug );

	const status = readString( object.status );
	if ( status === 'starting' ) {
		nextSnapshot.message = 'starting';
	} else if ( status === 'complete' && nextSnapshot.phase ) {
		nextSnapshot.message = 'complete';
	} else if ( status && ! nextSnapshot.message ) {
		nextSnapshot.message = status;
	}

	// reprint emits files_done and files_total over stdout, but files_done
	// is only a coarse mid-batch counter.  The exact committed-entry count comes
	// from the local reprint index files and is merged in by createProgressReporter().
	const downloadedFiles =
		readNumber( object.files_done ) ??
		readNumber( object.downloaded_files ) ??
		readNumber( object.files_indexed ) ??
		readNumber( object.index_size );
	const totalFiles = readNumber( object.files_total ) ?? readNumber( object.total_files );
	const downloadedBytes =
		readNumber( object.downloaded_bytes ) ??
		readNumber( object.bytes_done ) ??
		readNumber( object.bytes_read );
	const totalBytes = readNumber( object.total_bytes ) ?? readNumber( object.bytes_total );
	const bytesReceived = readNumber( object.bytes_received );
	const rateBps = readNumber( object.rate_bps );
	const statementsExecuted = readNumber( object.statements_executed );
	const statementsTotal = readNumber( object.statements_total );

	// files_done from reprint can briefly drop on exit-code-2 restarts
	// (files_imported resets to 0 before the batch offset advances).  Hold
	// the high-water mark so the displayed count never goes backward.
	if ( downloadedFiles !== undefined ) {
		nextSnapshot.downloadedFiles = Math.max( downloadedFiles, snapshot.downloadedFiles ?? 0 );
	}
	if ( totalFiles !== undefined ) {
		nextSnapshot.totalFiles = totalFiles;
	}
	if ( downloadedBytes !== undefined ) {
		nextSnapshot.downloadedBytes = Math.max( downloadedBytes, snapshot.downloadedBytes ?? 0 );
	}
	if ( totalBytes !== undefined ) {
		nextSnapshot.totalBytes = totalBytes;
	}
	// bytes_received is cumulative within one HTTP request but resets
	// across requests.  Accumulate it so the displayed total only grows.
	if ( bytesReceived !== undefined ) {
		const prev = snapshot.currentRequestBytesReceived ?? 0;
		const cumulative = snapshot.bytesReceived ?? 0;
		const restarted = bytesReceived < prev;
		const base = restarted ? cumulative : cumulative - prev;

		nextSnapshot.currentRequestBytesReceived = bytesReceived;
		nextSnapshot.bytesReceived = base + bytesReceived;
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

export function formatReprintProgressSnapshot(
	snapshot: ReprintProgressSnapshot,
	progressLabel: string,
	elapsedSeconds: number
): string | null {
	const elapsed = formatElapsedSeconds( elapsedSeconds );
	// Use reprint's phase as the label when it describes what's
	// actually happening (e.g. "indexing remote files" instead of the
	// generic "Downloading essential files" during the index phase).
	const label =
		snapshot.phase && snapshot.phase !== 'streaming' && snapshot.phase !== 'starting'
			? snapshot.phase.charAt( 0 ).toUpperCase() + snapshot.phase.slice( 1 )
			: progressLabel;
	const segments = [ label ];

	// Only show the file count once the total is known — a bare "X files"
	// without context is noise.  Always use X/Y format for consistency.
	if ( snapshot.totalFiles !== undefined ) {
		const downloaded = snapshot.downloadedFiles ?? 0;
		segments.push( `${ downloaded }/${ snapshot.totalFiles } files` );
	}

	if ( snapshot.downloadedBytes !== undefined && snapshot.totalBytes !== undefined ) {
		segments.push(
			`${ formatBytes( snapshot.downloadedBytes ) }/${ formatBytes( snapshot.totalBytes ) }`
		);
	} else if ( snapshot.downloadedBytes !== undefined ) {
		segments.push( `${ formatBytes( snapshot.downloadedBytes ) } downloaded` );
	} else if ( snapshot.bytesReceived !== undefined ) {
		segments.push( `${ formatBytes( snapshot.bytesReceived ) } received` );
	}

	if ( snapshot.statementsExecuted !== undefined || snapshot.statementsTotal !== undefined ) {
		if ( snapshot.statementsExecuted !== undefined && snapshot.statementsTotal !== undefined ) {
			segments.push( `${ snapshot.statementsExecuted }/${ snapshot.statementsTotal } statements` );
		} else if ( snapshot.statementsExecuted !== undefined ) {
			segments.push( `${ snapshot.statementsExecuted } statements` );
		}
	}

	// Don't echo the message when it would duplicate data already shown in
	// a structured segment (e.g. "[2838 files]" alongside "0/2838 files",
	// or "db-apply: 100/500 statements" alongside the statements segment).
	// Only suppress when we're actually rendering the structured segment —
	// totalFiles must be defined (not just downloadedFiles) because the
	// file segment is gated on totalFiles.
	const hasStructuredCounts =
		snapshot.totalFiles !== undefined || snapshot.statementsExecuted !== undefined;
	if ( snapshot.message && snapshot.message !== snapshot.phase && ! hasStructuredCounts ) {
		segments.push( snapshot.message );
	}

	if ( segments.length === 1 ) {
		return null;
	}

	segments.push( elapsed );
	return segments.join( ' · ' );
}

export function formatReprintJsonlProgress(
	record: unknown,
	progressLabel: string,
	elapsedSeconds: number
): string | null {
	const snapshot = updateReprintProgressSnapshot( record );
	if ( ! snapshot ) {
		return null;
	}

	return formatReprintProgressSnapshot( snapshot, progressLabel, elapsedSeconds );
}

export function applyReprintProgressDisplayHints(
	snapshot: ReprintProgressSnapshot,
	command: string | undefined,
	idleMs: number
): ReprintProgressSnapshot {
	if (
		command !== 'db-sync' ||
		snapshot.phase !== 'downloading' ||
		( snapshot.bytesReceived ?? 0 ) <= 0 ||
		idleMs < SQL_ANALYZING_STALL_MS
	) {
		return snapshot;
	}

	return {
		...snapshot,
		phase: 'analyzing SQL',
		message: 'analyzing SQL',
	};
}

function getReprintChildPath(): string {
	for ( const filename of [ 'reprint-child.mjs', 'reprint-child.js' ] ) {
		const candidate = path.resolve( import.meta.dirname, filename );
		if ( fs.existsSync( candidate ) ) {
			return candidate;
		}
	}

	return path.resolve( import.meta.dirname, 'reprint-child.mjs' );
}

function createProgressReporter(
	command: string | undefined,
	progressRoot: string | undefined,
	progressLabel: string,
	defaultPhase: string | undefined,
	startTime: number,
	onProgress?: ( output: string ) => void
) {
	const indexProgressTracker =
		command === 'files-sync' && progressRoot
			? new ReprintIndexProgressTracker( progressRoot )
			: undefined;
	let stdoutLineBuffer = '';
	let progressSnapshot: ReprintProgressSnapshot | null = defaultPhase
		? { phase: defaultPhase }
		: null;
	let lastRenderedSecond = -1;
	let lastTransferredBytes = 0;
	let lastTransferProgressAtMs = startTime;
	// Once reprint reaches the streaming/fetch phase, lock the
	// displayed label to progressLabel.  Without this, exit-code-2
	// restarts briefly cycle through index → diff → fetch again,
	// causing the label to blink from "Downloading files" to
	// "Indexing remote files" and back.
	let phaseLabelLocked = false;

	const mergeExactIndexedProgress = () => {
		if ( ! progressSnapshot || ! indexProgressTracker ) {
			return;
		}

		progressSnapshot = applyIndexedEntryProgress(
			progressSnapshot,
			indexProgressTracker.getIndexedEntries()
		);
	};

	const noteTransferProgress = () => {
		if ( ! progressSnapshot ) {
			return;
		}

		const transferredBytes = Math.max(
			progressSnapshot.downloadedBytes ?? 0,
			progressSnapshot.bytesReceived ?? 0
		);
		if ( transferredBytes > lastTransferredBytes ) {
			lastTransferredBytes = transferredBytes;
			lastTransferProgressAtMs = Date.now();
		}
	};

	const snapshotForDisplay = (): ReprintProgressSnapshot => {
		if ( ! progressSnapshot ) {
			return {};
		}
		let displaySnapshot = progressSnapshot;
		if ( displaySnapshot.phase === 'streaming' ) {
			phaseLabelLocked = true;
		}
		if ( phaseLabelLocked && displaySnapshot.phase !== 'streaming' ) {
			displaySnapshot = { ...displaySnapshot, phase: 'streaming' };
		}

		return applyReprintProgressDisplayHints(
			displaySnapshot,
			command,
			Date.now() - lastTransferProgressAtMs
		);
	};

	const reportLines = ( lines: string[] ) => {
		if ( ! onProgress ) {
			return;
		}

		for ( const line of lines ) {
			const record = parseJsonlRecord( line );
			const nextSnapshot = updateReprintProgressSnapshot( record, progressSnapshot ?? undefined );
			if ( nextSnapshot ) {
				progressSnapshot = nextSnapshot;
			}
			mergeExactIndexedProgress();
			noteTransferProgress();
			const progressMessage = formatReprintProgressSnapshot(
				snapshotForDisplay(),
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

			mergeExactIndexedProgress();
			noteTransferProgress();
			const progressMessage = formatReprintProgressSnapshot(
				snapshotForDisplay(),
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

async function runReprintCommand(
	pharPath: string,
	stateDir: string,
	docroot: string,
	tmpDir: string,
	args: string[],
	options: RunReprintOptions,
	progressReporter: ProgressReporter
): Promise< ReprintProcessResult > {
	const childPath = getReprintChildPath();

	if ( options.verboseCommands ) {
		const mountsSuffix =
			options.mounts && options.mounts.length > 0
				? ` mounts=${ options.mounts
						.map( ( mount ) => `${ mount.hostPath }:${ mount.vfsPath }` )
						.join( ',' ) }`
				: '';
		console.error( `[reprint] php reprint.phar ${ args.join( ' ' ) }${ mountsSuffix }` );
	}

	return await new Promise< ReprintProcessResult >( ( resolve, reject ) => {
		const child: ChildProcess = fork( childPath, [], {
			stdio: [ 'pipe', 'pipe', 'pipe', 'ipc' ],
		} );
		let settled = false;
		const childStderrChunks: string[] = [];

		const sigintHandler = () => {
			child.kill( 'SIGKILL' );
			process.exit( 130 );
		};

		const cleanup = () => {
			process.removeListener( 'SIGINT', sigintHandler );
		};

		child.stderr?.on( 'data', ( chunk: Buffer ) => {
			childStderrChunks.push( chunk.toString() );
		} );

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
				progressReporter.flush();

				if ( msg.type === 'result' ) {
					resolve( {
						stdout: msg.stdout || '',
						stderr: msg.stderr || '',
						exitCode: msg.exitCode ?? 1,
					} );
					return;
				}

				if ( msg.type === 'error' ) {
					reject( new Error( msg.message || 'reprint child process error' ) );
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
				reject( new Error( `reprint child process exited with code ${ code }. ${ details }` ) );
			}
		} );

		// Register SIGINT after all event handlers are attached so that
		// an exception between fork() and here can't leak the handler.
		process.on( 'SIGINT', sigintHandler );

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

export async function runReprintCommandUntilComplete(
	stateDir: string,
	docroot: string,
	args: string[],
	onProgress?: ( output: string ) => void,
	options: RunReprintOptions = {}
): Promise< ReprintProcessResult > {
	const pharPath = getBundledReprintPhar();
	const tmpDir = path.join( path.dirname( stateDir ), 'tmp' );
	fs.mkdirSync( tmpDir, { recursive: true } );

	const progressLabel = options.progressLabel ?? args[ 0 ] ?? 'Importing';
	const defaultPhase = getDefaultPhaseForCommand( args[ 0 ] );
	const startTime = Date.now();

	// Create the progress reporter once so cumulative counters (bytes received,
	// file counts) survive across reprint restarts (exit code 2).
	const progressReporter = createProgressReporter(
		args[ 0 ],
		options.progressRoot ?? stateDir,
		progressLabel,
		defaultPhase,
		startTime,
		onProgress
	);

	let lastResult: ReprintProcessResult | undefined;

	try {
		do {
			lastResult = await runReprintCommand(
				pharPath,
				stateDir,
				docroot,
				tmpDir,
				args,
				options,
				progressReporter
			);

			if ( lastResult.exitCode === 1 ) {
				const details = [ lastResult.stderr, lastResult.stdout ].filter( Boolean ).join( '\n' );
				throw new Error(
					details ||
						`reprint.phar exited with code 1 (command: ${
							args[ 0 ] ?? 'unknown'
						}). No output was captured.`
				);
			}
		} while ( lastResult.exitCode === 2 );

		return lastResult;
	} finally {
		progressReporter.cleanup();
	}
}
