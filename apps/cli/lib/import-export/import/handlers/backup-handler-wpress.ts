import * as fs from 'fs';
import { constants } from 'fs';
import * as path from 'path';
import { ImportEvents } from '@studio/common/lib/import-export-events';
import { __, sprintf } from '@wordpress/i18n';
import * as fse from 'fs-extra';
import { LoggerError } from 'cli/logger';
import { ImportExportEventEmitter } from '../../events';
import { BackupArchiveInfo } from '../types';
import { BackupHandler } from './backup-handler-factory';

/**
 * The .wpress format is a custom archive format used by All-In-One WP Migration.
 * It is designed to encapsulate all necessary components of a WordPress site, including the database,
 * plugins, themes, uploads, and other wp-content files, into a single file for easy transport and restoration.
 *
 * The .wpress file is structured as follows:
 * 1. Header: Contains metadata about the file, such as the name, size, modification time, and prefix.
 *    The header is a fixed size of 4377 bytes.
 * 2. Data Blocks: The actual content of the files, stored in 512-byte blocks. Each file's data is stored
 *    sequentially, following its corresponding header.
 * 3. End of File Marker: A special marker indicating the end of the archive. This is represented by a
 *    block of 4377 bytes filled with zeroes.
 *
 * The .wpress format ensures that all necessary components of a WordPress site are included in the backup,
 * making it easy to restore the site to its original state. The format is designed to be efficient and
 * easy to parse, allowing for quick extraction and restoration of the site's contents.
 */

const HEADER_SIZE = 4377;
const HEADER_CHUNK_EOF = Buffer.alloc( HEADER_SIZE );
const CHUNK_SIZE_TO_READ = 1024;

interface Header {
	name: string;
	size: number;
	mTime: string;
	prefix: string;
}

/**
 * Reads a string from a buffer at a given start and end position.
 *
 * @param {Buffer} buffer - The buffer to read from.
 * @param {number} start - The start position of the string in the buffer.
 * @param {number} end - The end position of the string in the buffer.
 * @returns {string} - The substring buffer, stopping at a null-terminator if present.
 */
function readFromBuffer( buffer: Buffer, start: number, end: number ): string {
	const _buffer = buffer.subarray( start, end );
	return _buffer.subarray( 0, _buffer.indexOf( 0x00 ) ).toString();
}

/**
 * Reads the header located at `position` in a .wpress file.
 *
 * Reads always use an explicit position instead of the file handle's implicit
 * cursor, so skipping an entry is a matter of arithmetic and never requires
 * reading (or allocating) its content. This is what keeps entries larger than
 * 2 GiB from crashing the process: `FileHandle.read()` rejects lengths that do
 * not fit in a signed 32-bit integer.
 *
 * @param {fs.promises.FileHandle} fd - The file handle to read from.
 * @param {number} position - The byte offset of the header in the archive.
 * @returns {Promise<Header | null>} - A promise that resolves to the header, or null when the end of the archive is reached.
 */
async function readHeader(
	fd: fs.promises.FileHandle,
	position: number
): Promise< Header | null > {
	const headerChunk = Buffer.alloc( HEADER_SIZE );
	const { bytesRead } = await fd.read( headerChunk, 0, HEADER_SIZE, position );

	// A clean end of file without the EOF marker, or with only part of it, is
	// treated like the marker itself: every entry before it is complete.
	if ( bytesRead === 0 || headerChunk.subarray( 0, bytesRead ).every( ( byte ) => byte === 0 ) ) {
		return null;
	}

	if ( bytesRead < HEADER_SIZE ) {
		throw new LoggerError(
			__( 'The backup archive is truncated: it ends in the middle of a file header.' ),
			undefined,
			'wpress_truncated'
		);
	}

	if ( Buffer.compare( headerChunk, HEADER_CHUNK_EOF ) === 0 ) {
		return null;
	}

	const name = readFromBuffer( headerChunk, 0, 255 );
	const size = parseInt( readFromBuffer( headerChunk, 255, 269 ), 10 );
	const mTime = readFromBuffer( headerChunk, 269, 281 );
	const prefix = readFromBuffer( headerChunk, 281, HEADER_SIZE );

	if ( ! Number.isSafeInteger( size ) || size < 0 ) {
		throw new LoggerError(
			sprintf( __( 'The backup archive is corrupted: invalid size for "%s".' ), name ),
			undefined,
			'wpress_corrupted'
		);
	}

	return {
		name,
		size,
		mTime,
		prefix,
	};
}

function isPathWithinDirectory( filePath: string, directory: string ): boolean {
	const resolvedFile = path.resolve( filePath );
	const resolvedDir = path.resolve( directory );
	return resolvedFile.startsWith( resolvedDir + path.sep ) || resolvedFile === resolvedDir;
}

/**
 * Copies the content of one archive entry, starting at `position`, into the
 * extraction directory.
 *
 * Entries that would land outside the extraction directory are not extracted.
 * Nothing is read for them: the caller advances past them using the size
 * recorded in the header.
 *
 * @param {fs.promises.FileHandle} fd - The file handle to read from.
 * @param {Header} header - The header of the entry to extract.
 * @param {string} outputPath - The extraction directory.
 * @param {number} position - The byte offset of the entry content in the archive.
 * @returns {Promise<void>} - Resolves once the extracted file is fully written and closed.
 */
async function readBlockToFile(
	fd: fs.promises.FileHandle,
	header: Header,
	outputPath: string,
	position: number
): Promise< void > {
	const outputFilePath = path.join( outputPath, header.prefix, header.name );

	if ( ! isPathWithinDirectory( outputFilePath, outputPath ) ) {
		return;
	}

	await fse.ensureDir( path.dirname( outputFilePath ) );
	const outputStream = fs.createWriteStream( outputFilePath );

	// Resolve once the underlying fd is closed — either after end() flushes or
	// after an error destroys the stream. Awaiting this before returning prevents
	// the caller from touching the file while it is still open.
	const closed = new Promise< void >( ( resolve ) => {
		outputStream.once( 'close', () => resolve() );
	} );

	let totalBytesToRead = header.size;
	let readPosition = position;
	let failure: Error | undefined;
	let streamEnded = false;

	const endStream = () => {
		if ( ! streamEnded && ! outputStream.destroyed ) {
			streamEnded = true;
			outputStream.end();
		}
	};

	outputStream.once( 'error', ( error: Error ) => {
		failure ??= error;
	} );

	try {
		while ( totalBytesToRead > 0 && ! failure && ! outputStream.destroyed ) {
			const bytesToRead = Math.min( CHUNK_SIZE_TO_READ, totalBytesToRead );
			const buffer = Buffer.alloc( bytesToRead );
			const { bytesRead } = await fd.read( buffer, 0, bytesToRead, readPosition );
			if ( bytesRead === 0 ) {
				throw new LoggerError(
					sprintf(
						__( 'The backup archive is truncated: "%s" is shorter than its header declares.' ),
						header.name
					),
					undefined,
					'wpress_truncated'
				);
			}
			// A read may return fewer bytes than requested; only forward what was read.
			outputStream.write( buffer.subarray( 0, bytesRead ) );
			totalBytesToRead -= bytesRead;
			readPosition += bytesRead;
		}
	} catch ( error ) {
		failure ??= error as Error;
	} finally {
		endStream();
		await closed;
	}

	if ( failure ) {
		if ( failure instanceof LoggerError ) {
			throw failure;
		}
		throw new LoggerError(
			sprintf( __( 'Failed to extract "%s" from the backup archive.' ), header.name ),
			failure,
			'wpress_extract_failed'
		);
	}
}

export class BackupHandlerWpress extends ImportExportEventEmitter implements BackupHandler {
	private bytesRead: number;
	private eof: Buffer;
	private totalFiles: number = 0;
	private processedFiles: number = 0;

	constructor() {
		super();
		this.bytesRead = 0;
		this.eof = Buffer.alloc( HEADER_SIZE, '\0' );
	}

	private calculateProgress(): number {
		return this.totalFiles > 0 ? Math.round( ( this.processedFiles / this.totalFiles ) * 100 ) : 0;
	}

	/**
	 * Lists all files in a .wpress backup file by reading the headers sequentially.
	 *
	 * It opens the .wpress file, reads each header to get the file names, and stores them in an array.
	 * The function continues reading headers until it reaches the end of the file.
	 *
	 * @param {BackupArchiveInfo} file - The backup archive information, including the file path.
	 * @returns {Promise<string[]>} - A promise that resolves to an array of file names.
	 */
	async listFiles( file: BackupArchiveInfo ): Promise< string[] > {
		const fileNames: string[] = [];

		try {
			await fs.promises.access( file.path, constants.F_OK );
		} catch ( error ) {
			throw new LoggerError(
				sprintf( __( 'Input file at location "%s" could not be found.' ), file.path ),
				undefined,
				'file_not_found'
			);
		}

		const inputFile = await fs.promises.open( file.path, 'r' );

		// Walk the headers only. Entry content is skipped by position, so the
		// size of an entry (which can exceed 2 GiB) never has to fit in memory.
		try {
			let position = 0;
			let header;
			while ( ( header = await readHeader( inputFile, position ) ) !== null ) {
				position += HEADER_SIZE;
				const filePath = path.join( header.prefix, header.name );
				if ( ! filePath.split( path.sep ).includes( '..' ) ) {
					fileNames.push( filePath );
				}
				position += header.size;
			}
		} finally {
			await inputFile.close();
		}

		return fileNames;
	}

	/**
	 * Extracts files from a .wpress backup file into a specified extraction directory.
	 *
	 * @param {BackupArchiveInfo} file - The backup archive information, including the file path.
	 * @param {string} extractionDirectory - The directory where the files will be extracted.
	 * @returns {Promise<void>} - A promise that resolves when the extraction is complete.
	 */
	async extractFiles( file: BackupArchiveInfo, extractionDirectory: string ): Promise< void > {
		try {
			await fs.promises.access( file.path, constants.F_OK );
		} catch ( error ) {
			throw new LoggerError(
				sprintf( __( 'Input file at location "%s" could not be found.' ), file.path ),
				undefined,
				'file_not_found'
			);
		}

		await fse.emptyDir( extractionDirectory );

		// First pass: count total files
		const fileNames = await this.listFiles( file );
		this.totalFiles = fileNames.length;
		this.processedFiles = 0;

		this.emit( ImportEvents.BACKUP_EXTRACT_START );

		const inputFile = await fs.promises.open( file.path, 'r' );

		let position = 0;
		let header;
		try {
			while ( ( header = await readHeader( inputFile, position ) ) !== null ) {
				position += HEADER_SIZE;

				// Emit progress before processing file
				const currentFile = path.join( header.prefix, header.name );

				this.emit( ImportEvents.BACKUP_EXTRACT_FILE_START, {
					progress: this.calculateProgress(),
					processedFiles: this.processedFiles,
					totalFiles: this.totalFiles,
					currentFile,
				} );

				await readBlockToFile( inputFile, header, extractionDirectory, position );
				position += header.size;
				this.processedFiles++;

				// Emit progress after processing file
				this.emit( ImportEvents.BACKUP_EXTRACT_PROGRESS, {
					progress: this.calculateProgress(),
					processedFiles: this.processedFiles,
					totalFiles: this.totalFiles,
					currentFile,
				} );
			}

			this.emit( ImportEvents.BACKUP_EXTRACT_COMPLETE, {
				progress: 100,
				processedFiles: this.totalFiles,
				totalFiles: this.totalFiles,
			} );
		} finally {
			await inputFile.close();
		}
	}
}
