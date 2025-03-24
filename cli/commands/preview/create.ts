import fs from 'fs';
import os from 'os';
import path from 'path';
import archiver from 'archiver';
import { Command } from 'commander/typings';
import fetch from 'node-fetch';
import { BaseCommand, OutputFormat } from 'cli/commands/base';

// This is DUMMY code for now. It's only meant as a reference for the actual implementation.
export class PreviewCreateCommand extends BaseCommand {
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

	static register( program: Command ) {
		program
			.command( 'go [folder]' )
			.description(
				'Start a new WordPress environment in the specified folder (defaults to current directory)'
			)
			.action( async ( folder: string = process.cwd(), options: { outputFormat?: 'json' } ) => {
				const previewCreate = new PreviewCreateCommand( folder, options.outputFormat );
				await previewCreate.run();
			} );
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
