import * as fs from 'fs';
import { constants } from 'fs';
import * as path from 'path';
import { ImportEvents } from '@studio/common/lib/import-export-events';
import { __, sprintf } from '@wordpress/i18n';
import * as fse from 'fs-extra';
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
 * Reads the header of a .wpress file.
 *
 * @param {fs.promises.FileHandle} fd - The file handle to read from.
 * @returns {Promise<Header | null>} - A promise that resolves to the header or null if the end of the file is reached.
 */
async function readHeader( fd: fs.promises.FileHandle ): Promise< Header | null > {
	const headerChunk = Buffer.alloc( HEADER_SIZE );
	await fd.read( headerChunk, 0, HEADER_SIZE );

	if ( Buffer.compare( headerChunk, HEADER_CHUNK_EOF ) === 0 ) {
		return null;
	}

	const name = readFromBuffer( headerChunk, 0, 255 );
	const size = parseInt( readFromBuffer( headerChunk, 255, 269 ), 10 );
	const mTime = readFromBuffer( headerChunk, 269, 281 );
	const prefix = readFromBuffer( headerChunk, 281, HEADER_SIZE );

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
 * Reads a block of data from a .wpress file and writes it to a file.
 *
 * @param {fs.promises.FileHandle} fd - The file handle to read from.
 * @param {Header} header - The header of the file to read.
 * @param {string} outputPath - The path to write the file to.
 */
async function readBlockToFile( fd: fs.promises.FileHandle, header: Header, outputPath: string ) {
	const outputFilePath = path.join( outputPath, header.prefix, header.name );

	if ( ! isPathWithinDirectory( outputFilePath, outputPath ) ) {
		await fd.read( Buffer.alloc( header.size ), 0, header.size, null );
		return;
	}

	await fse.ensureDir( path.dirname( outputFilePath ) );
	const outputStream = fs.createWriteStream( outputFilePath );

	// Resolve once the underlying fd is closed — either after end() flushes or
	// after an error destroys the stream. Awaiting this before returning prevents
	// the writeStream's lazy open + flush from racing with synchronous existence
	// checks in the caller (manifested as a Windows-only test flake; libuv's
	// worker happens to flush fast enough on Linux/macOS to mask it).
	const closed = new Promise< void >( ( resolve ) => {
		outputStream.once( 'close', () => resolve() );
	} );

	let totalBytesToRead = header.size;
	let errored = false;
	let streamEnded = false;

	const errorHandler = () => {
		if ( ! errored ) {
			errored = true;
		}
	};

	const endStream = () => {
		if ( ! streamEnded && ! outputStream.destroyed ) {
			streamEnded = true;
			outputStream.end();
		}
	};

	outputStream.once( 'error', errorHandler );

	try {
		while ( totalBytesToRead > 0 ) {
			let bytesToRead = CHUNK_SIZE_TO_READ;
			if ( bytesToRead > totalBytesToRead ) {
				bytesToRead = totalBytesToRead;
			}
			if ( bytesToRead === 0 ) break;
			const buffer = Buffer.alloc( bytesToRead );
			const data = await fd.read( buffer, 0, bytesToRead );
			if ( errored || outputStream.destroyed ) {
				return;
			}
			outputStream.write( buffer );
			totalBytesToRead -= data.bytesRead;
		}
	} catch ( err ) {
		errorHandler();
	} finally {
		endStream();
		await closed;
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
			throw new Error(
				sprintf( __( 'Input file at location "%s" could not be found.' ), file.path )
			);
		}

		const inputFile = await fs.promises.open( file.path, 'r' );

		// Read all of the headers and file data into memory.
		try {
			let header;
			do {
				header = await readHeader( inputFile );
				if ( header ) {
					const filePath = path.join( header.prefix, header.name );
					if ( ! filePath.split( path.sep ).includes( '..' ) ) {
						fileNames.push( filePath );
					}
					await inputFile.read( Buffer.alloc( header.size ), 0, header.size, null );
				}
			} while ( header );
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
			throw new Error(
				sprintf( __( 'Input file at location "%s" could not be found.' ), file.path )
			);
		}

		await fse.emptyDir( extractionDirectory );

		// First pass: count total files
		const fileNames = await this.listFiles( file );
		this.totalFiles = fileNames.length;
		this.processedFiles = 0;

		this.emit( ImportEvents.BACKUP_EXTRACT_START );

		const inputFile = await fs.promises.open( file.path, 'r' );

		let header;
		try {
			while ( ( header = await readHeader( inputFile ) ) !== null ) {
				if ( ! header ) {
					break;
				}

				// Emit progress before processing file
				const currentFile = path.join( header.prefix, header.name );

				this.emit( ImportEvents.BACKUP_EXTRACT_FILE_START, {
					progress: this.calculateProgress(),
					processedFiles: this.processedFiles,
					totalFiles: this.totalFiles,
					currentFile,
				} );

				await readBlockToFile( inputFile, header, extractionDirectory );
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
