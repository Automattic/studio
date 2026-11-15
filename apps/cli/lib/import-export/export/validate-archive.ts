import { promisify } from 'util';
import { __ } from '@wordpress/i18n';
import { buf as crc32 } from 'crc-32';
import * as tar from 'tar';
import yauzl from 'yauzl';
import { LoggerError } from 'cli/logger';
import type { Readable } from 'stream';

const openZip = promisify< string, yauzl.Options, yauzl.ZipFile >( yauzl.open );

async function validateZip( filePath: string ): Promise< void > {
	const zip = await openZip( filePath, { lazyEntries: true } );
	const openReadStream = promisify( zip.openReadStream.bind( zip ) );
	let currentStream: Readable | undefined;
	try {
		await new Promise< void >( ( resolve, reject ) => {
			zip.on( 'error', reject );
			zip.on( 'end', resolve );
			zip.on( 'entry', ( entry: yauzl.Entry ) => {
				const checkEntry = async () => {
					currentStream = await openReadStream( entry );
					let checksum = 0;
					for await ( const chunk of currentStream ) {
						checksum = crc32( chunk, checksum );
					}
					if ( checksum >>> 0 !== entry.crc32 ) {
						throw new Error( `Invalid checksum for ${ entry.fileName }` );
					}
				};
				void checkEntry().then( () => zip.readEntry(), reject );
			} );
			zip.readEntry();
		} );
	} finally {
		currentStream?.destroy();
		zip.close();
	}
}

export async function validateExportArchive( filePath: string ): Promise< void > {
	try {
		if ( filePath.endsWith( '.zip' ) ) {
			await validateZip( filePath );
		} else {
			await tar.t( { file: filePath, strict: true } );
		}
	} catch ( error ) {
		throw new LoggerError( __( 'Failed to validate exported archive' ), error, 'archive' );
	}
}
