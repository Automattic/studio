/**
 * Migration Client – thin wrapper around importer.phar
 *
 * Downloads and runs the streaming-site-migration CLI tool via PHP WASM
 * in a child process. The child process isolates PHP WASM execution so
 * the main process stays responsive for Ctrl+C and progress reporting.
 *
 * Progress is reported by reading the importer's remote file index
 * (.import-remote-index.jsonl) for totals and scanning the docroot
 * for downloaded file counts. The progress line updates continuously
 * across resume iterations (exit code 2) without interruption.
 *
 * See https://github.com/adamziel/streaming-site-migration
 */
import { fork, ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { getAppdataDirectory } from 'cli/lib/appdata';

const IMPORTER_PHAR_URL =
	'https://github.com/adamziel/streaming-site-migration/releases/latest/download/importer.phar';

export interface ImporterResult {
	stdout: string;
	stderr: string;
	exitCode: number;
}

/**
 * Returns file count and total size of all files in a directory tree.
 */
function getDirectoryStats( dir: string ): { files: number; bytes: number } {
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
					// File may have been moved/deleted mid-scan
				}
			}
		}
	} catch {
		// Directory may not exist yet
	}
	return { files, bytes };
}

/**
 * Reads the importer's remote file index (.import-remote-index.jsonl)
 * to get the total number of files and their combined size. Each line
 * is a JSON object with { path, size, type, ctime, ... }.
 *
 * Returns null if the index file doesn't exist yet (indexing phase
 * hasn't started or hasn't written anything).
 */
function readRemoteIndex( stateDir: string ): { files: number; bytes: number } | null {
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
			continue;
		}
	}

	return files > 0 ? { files, bytes } : null;
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

/**
 * Runs an importer.phar command, automatically re-running on exit
 * code 2 (partial completion / needs resume). Reports real-time
 * progress by reading the importer's state files and scanning the
 * docroot directory.
 *
 * During files-sync, progress shows "X/Y files · A.B/C.D MB" by
 * reading the remote file index (.import-remote-index.jsonl) for
 * totals and scanning the docroot for downloaded counts. For other
 * commands, shows simple downloaded size.
 *
 * Downloads importer.phar on first use. Runs PHP WASM in a forked
 * child process so the main event loop stays responsive for Ctrl+C
 * and progress reporting.
 */
export async function runImporterCommandUntilComplete(
	stateDir: string,
	docroot: string,
	args: string[],
	onProgress?: ( output: string ) => void
): Promise< ImporterResult > {
	// Download importer.phar if not already cached
	const pharPath = path.join( getAppdataDirectory(), 'importer.phar' );
	if ( ! fs.existsSync( pharPath ) ) {
		const response = await fetch( IMPORTER_PHAR_URL, { redirect: 'follow' } );
		if ( ! response.ok ) {
			throw new Error( `Failed to download importer.phar: ${ response.status }` );
		}
		const buffer = Buffer.from( await response.arrayBuffer() );
		fs.writeFileSync( pharPath, buffer );
	}

	// Create a persistent tmp directory alongside state/ and docroot/
	// so that the importer's temp files (batch downloads) survive
	// process restarts between resume iterations.
	const tmpDir = path.join( path.dirname( stateDir ), 'tmp' );
	fs.mkdirSync( tmpDir, { recursive: true } );

	const childPath = path.resolve( __dirname, 'importer-child.js' );
	let lastResult: ImporterResult;
	const label = args[ 0 ] || 'Importing';

	// Poll the importer's state files and docroot every second to
	// report progress. For files-sync, reads the remote file index
	// to show "X/Y files · A.B/C.D MB". Detects stalls after 3
	// ticks of no growth.
	const startTime = Date.now();
	let lastBytes = 0;
	let stallTicks = 0;
	const progressTimer = onProgress
		? setInterval( () => {
				const downloaded = getDirectoryStats( docroot );
				const stateStats = getDirectoryStats( stateDir );
				const totalBytes = downloaded.bytes + stateStats.bytes;

				const elapsed = Math.round( ( Date.now() - startTime ) / 1000 );
				const mins = Math.floor( elapsed / 60 );
				const secs = elapsed % 60;
				const timeStr = mins > 0 ? `${ mins }m ${ secs }s` : `${ secs }s`;

				// Detect stalls: if size hasn't changed for a few ticks,
				// show a "processing" hint so the user knows it's not stuck.
				if ( totalBytes === lastBytes ) {
					stallTicks++;
				} else {
					stallTicks = 0;
					lastBytes = totalBytes;
				}

				const stallHint = stallTicks >= 3 ? ' · processing' : '';

				// For files-sync, try to read the remote file index to
				// show detailed "X/Y files · A.B/C.D MB" progress.
				const remoteIndex = label === 'files-sync' ? readRemoteIndex( stateDir ) : null;

				if ( remoteIndex ) {
					const fileProg = `${ downloaded.files }/${ remoteIndex.files } files`;
					const sizeProg = `${ formatBytes( downloaded.bytes ) }/${ formatBytes(
						remoteIndex.bytes
					) }`;
					onProgress( `${ label } · ${ fileProg } · ${ sizeProg }${ stallHint } · ${ timeStr }` );
				} else {
					onProgress(
						`${ label } · ${ formatBytes( totalBytes ) } downloaded${ stallHint } · ${ timeStr }`
					);
				}
		  }, 1000 )
		: undefined;

	try {
		do {
			// Run a single importer.phar invocation in a child process.
			// PHP WASM blocks the event loop, so forking keeps the parent
			// responsive for signal handling and progress reporting.
			lastResult = await new Promise< ImporterResult >( ( resolve, reject ) => {
				const child: ChildProcess = fork( childPath, [], {
					stdio: [ 'pipe', 'pipe', 'pipe', 'ipc' ],
				} );
				let settled = false;

				// Collect the child's stderr so we can include it in crash diagnostics
				const childStderrChunks: string[] = [];
				child.stderr?.on( 'data', ( chunk: Buffer ) => {
					childStderrChunks.push( chunk.toString() );
				} );

				// Forward Ctrl+C to the child process
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
						} else if ( msg.type === 'error' ) {
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

				child.send( { type: 'run', pharPath, stateDir, docroot, tmpDir, args } );
			} );

			if ( lastResult.exitCode === 1 ) {
				const details = [ lastResult.stderr, lastResult.stdout ].filter( Boolean ).join( '\n' );
				throw new Error( details || 'importer.phar failed' );
			}

			// Exit code 2 = partial completion, will resume.
			// Progress timer keeps running — no status line interruption.
		} while ( lastResult.exitCode === 2 );

		return lastResult;
	} finally {
		if ( progressTimer ) {
			clearInterval( progressTimer );
		}
	}
}
