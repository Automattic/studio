/**
 * Migration Client – thin wrapper around importer.phar
 *
 * Downloads and runs the streaming-site-migration CLI tool via PHP WASM
 * in a child process. The child process isolates PHP WASM execution so
 * the main process stays responsive for Ctrl+C and progress reporting.
 */
import { ChildProcess, fork } from 'node:child_process';
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
}

interface ImporterStatus {
	command?: string | null;
	phase?: string | null;
	status?: string | null;
}

interface DirectoryStats {
	files: number;
	bytes: number;
}

interface ImporterProgressSnapshot {
	downloaded: DirectoryStats;
	elapsedSeconds: number;
	importerStatus: ImporterStatus | null;
	isFilesSync: boolean;
	isFilteredFilesSync: boolean;
	progressLabel: string;
	remoteIndex: DirectoryStats | null;
	stallTicks: number;
	totalBytes: number;
}

function getDirectoryStats( dir: string ): DirectoryStats {
	let files = 0;
	let bytes = 0;

	try {
		for ( const entry of fs.readdirSync( dir, { withFileTypes: true } ) ) {
			const fullPath = path.join( dir, entry.name );
			if ( entry.isDirectory() ) {
				const sub = getDirectoryStats( fullPath );
				files += sub.files;
				bytes += sub.bytes;
			} else {
				try {
					files++;
					bytes += fs.statSync( fullPath ).size;
				} catch {
					// File may have changed during scanning.
				}
			}
		}
	} catch {
		// Directory may not exist yet.
	}

	return { files, bytes };
}

function readRemoteIndex( stateDir: string ): DirectoryStats | null {
	const indexPath = path.join( stateDir, '.import-remote-index.jsonl' );
	let content: string;

	try {
		content = fs.readFileSync( indexPath, 'utf-8' );
	} catch {
		return null;
	}

	let files = 0;
	let bytes = 0;
	for ( const line of content.split( '\n' ) ) {
		if ( ! line.trim() ) {
			continue;
		}

		try {
			const entry = JSON.parse( line );
			if ( entry.type === 'file' ) {
				files++;
				bytes += entry.size || 0;
			}
		} catch {
			// Ignore malformed lines in partially-written state.
		}
	}

	return files > 0 ? { files, bytes } : null;
}

function readImporterStatus( stateDir: string ): ImporterStatus | null {
	const statusPath = path.join( stateDir, '.import-status.json' );

	try {
		return JSON.parse( fs.readFileSync( statusPath, 'utf-8' ) ) as ImporterStatus;
	} catch {
		return null;
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

function hasFilterArg( args: string[] ): boolean {
	return args.some( ( arg ) => arg.startsWith( '--filter=' ) );
}

export function formatImporterProgress( snapshot: ImporterProgressSnapshot ): string {
	const mins = Math.floor( snapshot.elapsedSeconds / 60 );
	const secs = snapshot.elapsedSeconds % 60;
	const timeStr = mins > 0 ? `${ mins }m ${ secs }s` : `${ secs }s`;
	const stallHint = snapshot.stallTicks >= 3 ? ' · processing' : '';

	if ( snapshot.isFilteredFilesSync && snapshot.importerStatus?.phase === 'index' ) {
		return `${ snapshot.progressLabel } · indexing remote files${ stallHint } · ${ timeStr }`;
	}

	if ( snapshot.remoteIndex ) {
		return `${ snapshot.progressLabel } · ${ snapshot.downloaded.files }/${
			snapshot.remoteIndex.files
		} files · ${ formatBytes( snapshot.downloaded.bytes ) }/${ formatBytes(
			snapshot.remoteIndex.bytes
		) }${ stallHint } · ${ timeStr }`;
	}

	const progressBytes = snapshot.isFilesSync ? snapshot.downloaded.bytes : snapshot.totalBytes;
	return `${ snapshot.progressLabel } · ${ formatBytes(
		progressBytes
	) } downloaded${ stallHint } · ${ timeStr }`;
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
	const pharPath = path.join( getConfigDirectory(), 'importer.phar' );
	if ( ! fs.existsSync( pharPath ) ) {
		return downloadLatestImporterPhar();
	}
	return pharPath;
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

	const childPath = getImporterChildPath();
	const isFilesSync = args[ 0 ] === 'files-sync';
	const isFilteredFilesSync = isFilesSync && hasFilterArg( args );
	const progressRoot = options.progressRoot ?? docroot;
	const progressLabel = options.progressLabel ?? args[ 0 ] ?? 'Importing';

	let lastResult: ImporterResult;
	const startTime = Date.now();
	let lastBytes = 0;
	let stallTicks = 0;

	const progressTimer = onProgress
		? setInterval( () => {
				const downloaded = getDirectoryStats( progressRoot );
				const stateStats = isFilesSync ? { files: 0, bytes: 0 } : getDirectoryStats( stateDir );
				const totalBytes = downloaded.bytes + stateStats.bytes;
				const progressBytes = isFilesSync ? downloaded.bytes : totalBytes;
				const elapsed = Math.round( ( Date.now() - startTime ) / 1000 );

				if ( progressBytes === lastBytes ) {
					stallTicks++;
				} else {
					stallTicks = 0;
					lastBytes = progressBytes;
				}

				const remoteIndex = isFilteredFilesSync
					? null
					: isFilesSync
					? readRemoteIndex( stateDir )
					: null;
				const importerStatus = isFilesSync ? readImporterStatus( stateDir ) : null;
				onProgress(
					formatImporterProgress( {
						downloaded,
						elapsedSeconds: elapsed,
						importerStatus,
						isFilesSync,
						isFilteredFilesSync,
						progressLabel,
						remoteIndex,
						stallTicks,
						totalBytes,
					} )
				);
		  }, 1000 )
		: undefined;

	try {
		do {
			lastResult = await new Promise< ImporterResult >( ( resolve, reject ) => {
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

				const cleanup = () => process.removeListener( 'SIGINT', sigintHandler );

				child.on(
					'message',
					( msg: {
						type: string;
						stdout?: string;
						stderr?: string;
						exitCode?: number;
						message?: string;
					} ) => {
						cleanup();
						settled = true;

						if ( msg.type === 'result' ) {
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
						reject(
							new Error( `importer child process exited with code ${ code }. ${ details }` )
						);
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

			if ( lastResult.exitCode === 1 ) {
				const details = [ lastResult.stderr, lastResult.stdout ].filter( Boolean ).join( '\n' );
				throw new Error( details || 'importer.phar failed' );
			}
		} while ( lastResult.exitCode === 2 );

		return lastResult;
	} finally {
		if ( progressTimer ) {
			clearInterval( progressTimer );
		}
	}
}
