import { EventEmitter } from 'events';
import * as fs from 'fs';
import { constants } from 'fs';
import * as path from 'path';
import * as fse from 'fs-extra';
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

/**
 * Reads a block of data from a .wpress file and writes it to a file.
 *
 * @param {fs.promises.FileHandle} fd - The file handle to read from.
 * @param {Header} header - The header of the file to read.
 * @param {string} outputPath - The path to write the file to.
 */
async function readBlockToFile( fd: fs.promises.FileHandle, header: Header, outputPath: string ) {
	const outputFilePath = path.join( outputPath, header.prefix, header.name );
	await fse.ensureDir( path.dirname( outputFilePath ) );
	const outputStream = fs.createWriteStream( outputFilePath );

	let totalBytesToRead = header.size;
	while ( totalBytesToRead > 0 ) {
		let bytesToRead = CHUNK_SIZE_TO_READ;
		if ( bytesToRead > totalBytesToRead ) {
			bytesToRead = totalBytesToRead;
		}

		if ( bytesToRead === 0 ) {
			break;
		}

		const buffer = Buffer.alloc( bytesToRead );
		const data = await fd.read( buffer, 0, bytesToRead );
		outputStream.write( buffer );

		totalBytesToRead -= data.bytesRead;
	}

	outputStream.close();
}

export class BackupHandlerWpress extends EventEmitter implements BackupHandler {
	private bytesRead: number;
	private eof: Buffer;

	constructor() {
		super();
		this.bytesRead = 0;
		this.eof = Buffer.alloc( HEADER_SIZE, '\0' );
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
			throw new Error( `Input file at location "${ file.path }" could not be found.` );
		}

		const inputFile = await fs.promises.open( file.path, 'r' );

		// Read all of the headers and file data into memory.
		try {
			let header;
			do {
				header = await readHeader( inputFile );
				if ( header ) {
					fileNames.push( path.join( header.prefix, header.name ) );
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
		return new Promise( ( resolve, reject ) => {
			( async () => {
				try {
					try {
						await fs.promises.access( file.path, constants.F_OK );
					} catch ( error ) {
						throw new Error( `Input file at location "${ file.path }" could not be found.` );
					}

					await fse.emptyDir( extractionDirectory );

					const inputFile = await fs.promises.open( file.path, 'r' );

					let header;
					while ( ( header = await readHeader( inputFile ) ) !== null ) {
						if ( ! header ) {
							break;
						}

						await readBlockToFile( inputFile, header, extractionDirectory );
					}

					await inputFile.close();
					resolve();
				} catch ( err ) {
					reject( err );
				}
			} )();
		} );
	}

	/**
	 * Checks if the provided file is a valid backup file.
	 *
	 * A valid backup file should have a header size of 4377 bytes and the last 4377 bytes should be 0.
	 *
	 * @param {BackupArchiveInfo} file - The backup archive information, including the file path.
	 * @returns {boolean} - True if the file is valid, otherwise false.
	 */
	isValid( file: BackupArchiveInfo ): boolean {
		const fd = fs.openSync( file.path, 'r' );
		const fileSize = fs.fstatSync( fd ).size;

		if ( fs.readSync( fd, this.eof, 0, HEADER_SIZE, fileSize - HEADER_SIZE ) !== HEADER_SIZE ) {
			fs.closeSync( fd );
			return false;
		}

		if ( Buffer.compare( this.eof, Buffer.alloc( HEADER_SIZE, '\0' ) ) !== 0 ) {
			fs.closeSync( fd );
			return false;
		}

		fs.closeSync( fd );
		return true;
	}
}
