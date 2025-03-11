import fs from 'fs';
import os from 'os';
import path from 'path';
import archiver from 'archiver';
import fetch from 'node-fetch';
import { BaseCommand, OutputFormat } from './base';

export class StudioGo extends BaseCommand {
	private folder: string;
	private archivePath: string;

	protected readonly STATUSES = {
		ARCHIVE_CREATED: 'ARCHIVE_CREATED',
		ARCHIVE_UPLOADED: 'ARCHIVE_UPLOADED',
		ARCHIVE_DELETED: 'ARCHIVE_DELETED',
	};

	constructor( folder: string, outputFormat: OutputFormat ) {
		super( outputFormat );
		this.folder = folder;
		this.archivePath = path.join( os.tmpdir(), `${ this.folder }.zip` );
	}

	async run() {
		await this.archiveFolder();
		await this.uploadArchive();
		await this.cleanup();
		return true;
	}

	async archiveFolder() {
		return new Promise( ( resolve, reject ) => {
			const output = fs.createWriteStream( this.archivePath );

			const archive = archiver( 'zip', {
				zlib: { level: 9 },
			} );

			output.on( 'close', () => {
				this.reportProgress( this.STATUSES.ARCHIVE_CREATED );
				resolve( archive );
			} );

			archive.on( 'error', ( err: Error ) => {
				this.reportError( err.message );
				reject( err );
			} );

			archive.pipe( output );
			archive.directory( `${ this.folder }/wp-content`, 'wp-content' );
			archive.file( `${ this.folder }/wp-config.php`, { name: 'wp-config.php' } );

			archive.finalize();
		} );
	}

	async uploadArchive() {
		const response = await fetch(
			'https://public-api.wordpress.com/rest/v1.1/jurassic-ninja/create-new-site-from-zip',
			{
				method: 'POST',
				body: fs.createReadStream( this.archivePath ),
			}
		);
		this.reportProgress( this.STATUSES.ARCHIVE_UPLOADED );
		return response.json();
	}

	async cleanup() {
		fs.unlinkSync( this.archivePath );
	}
}
