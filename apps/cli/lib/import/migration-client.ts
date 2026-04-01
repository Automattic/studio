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
	verboseCommands?: boolean;
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

export function formatImporterJsonlProgress(
	record: unknown,
	progressLabel: string,
	elapsedSeconds: number
): string | null {
	if ( ! record || typeof record !== 'object' || Array.isArray( record ) ) {
		return null;
	}

	const object = record as Record< string, unknown >;
	const elapsed = formatElapsedSeconds( elapsedSeconds );

	if ( 'http_code' in object || 'protocol_version' in object ) {
		return null;
	}

	const debug = readString( object.debug );
	if ( debug ) {
		return `${ progressLabel } · ${ debug } · ${ elapsed }`;
	}

	const phase = readString( object.phase );
	if ( phase === 'index' ) {
		return `${ progressLabel } · indexing remote files · ${ elapsed }`;
	}

	const downloadedFiles =
		readNumber( object.downloaded_files ) ??
		readNumber( object.files_done ) ??
		readNumber( object.completed_files );
	const totalFiles = readNumber( object.total_files ) ?? readNumber( object.files_total );
	const downloadedBytes =
		readNumber( object.downloaded_bytes ) ??
		readNumber( object.bytes_done ) ??
		readNumber( object.completed_bytes );
	const totalBytes = readNumber( object.total_bytes ) ?? readNumber( object.bytes_total );

	if (
		downloadedFiles !== undefined ||
		totalFiles !== undefined ||
		downloadedBytes !== undefined ||
		totalBytes !== undefined
	) {
		const segments = [ progressLabel ];

		if ( downloadedFiles !== undefined && totalFiles !== undefined ) {
			segments.push( `${ downloadedFiles }/${ totalFiles } files` );
		} else if ( downloadedFiles !== undefined ) {
			segments.push( `${ downloadedFiles } files` );
		}

		if ( downloadedBytes !== undefined && totalBytes !== undefined ) {
			segments.push( `${ formatBytes( downloadedBytes ) }/${ formatBytes( totalBytes ) }` );
		} else if ( downloadedBytes !== undefined ) {
			segments.push( `${ formatBytes( downloadedBytes ) } downloaded` );
		}

		segments.push( elapsed );
		return segments.join( ' · ' );
	}

	const message =
		readString( object.progress ) ??
		readString( object.message ) ??
		readString( object.status ) ??
		readString( object.event ) ??
		readString( object.type );

	if ( message ) {
		return `${ progressLabel } · ${ message } · ${ elapsed }`;
	}

	return null;
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
	const progressLabel = options.progressLabel ?? args[ 0 ] ?? 'Importing';

	let lastResult: ImporterResult | undefined;
	const startTime = Date.now();

	do {
		if ( options.verboseCommands ) {
			const mountsSuffix =
				options.mounts && options.mounts.length > 0
					? ` mounts=${ options.mounts
							.map( ( mount ) => `${ mount.hostPath }:${ mount.vfsPath }` )
							.join( ',' ) }`
					: '';
			console.error( `[importer] php importer.phar ${ args.join( ' ' ) }${ mountsSuffix }` );
		}

		lastResult = await new Promise< ImporterResult >( ( resolve, reject ) => {
			const child: ChildProcess = fork( childPath, [], {
				stdio: [ 'pipe', 'pipe', 'pipe', 'ipc' ],
			} );
			let settled = false;
			let stdoutLineBuffer = '';
			const childStderrChunks: string[] = [];

			const reportBufferedProgress = ( lines: string[] ) => {
				if ( ! onProgress ) {
					return;
				}

				for ( const line of lines ) {
					const progressMessage = formatImporterJsonlProgress(
						parseJsonlRecord( line ),
						progressLabel,
						Math.round( ( Date.now() - startTime ) / 1000 )
					);

					if ( progressMessage ) {
						onProgress( progressMessage );
					}
				}
			};

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
					chunk?: string;
					exitCode?: number;
					message?: string;
				} ) => {
					if ( msg.type === 'stdout' ) {
						stdoutLineBuffer += msg.chunk || '';
						const lines = stdoutLineBuffer.split( '\n' );
						stdoutLineBuffer = lines.pop() ?? '';
						reportBufferedProgress( lines );
						return;
					}

					if ( msg.type === 'stderr' ) {
						return;
					}

					cleanup();
					settled = true;

					if ( msg.type === 'result' ) {
						if ( stdoutLineBuffer.trim().length > 0 ) {
							reportBufferedProgress( [ stdoutLineBuffer.trim() ] );
						}
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

		if ( lastResult.exitCode === 1 ) {
			const details = [ lastResult.stderr, lastResult.stdout ].filter( Boolean ).join( '\n' );
			throw new Error( details || 'importer.phar failed' );
		}
	} while ( lastResult.exitCode === 2 );

	return lastResult;
}
