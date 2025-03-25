import fs from 'fs';
import os from 'os';
import path from 'path';
import archiver from 'archiver';
import { Command } from 'commander/typings';
import fetch from 'node-fetch';
import { Logger, OutputFormat } from 'cli/logger';

enum Status {
	ARCHIVE_CREATED = 'ARCHIVE_CREATED',
	ARCHIVE_UPLOADED = 'ARCHIVE_UPLOADED',
	ARCHIVE_DELETED = 'ARCHIVE_DELETED',
}

interface CommandInterface {
	run(): Promise< boolean >;
}

// This is DUMMY code for now. It's only meant as a reference for the actual implementation.
export class PreviewCreateCommand implements CommandInterface {
	private folder: string;
	private archivePath: string;
	private logger: Logger< Status >;

	constructor( folder: string, outputFormat: OutputFormat ) {
		this.folder = folder;
		this.archivePath = path.join( os.tmpdir(), `${ this.folder }.zip` );
		this.logger = new Logger< Status >( outputFormat );
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

	async archiveFolder(): Promise< archiver.Archiver > {
		return new Promise( ( resolve, reject ) => {
			const output = fs.createWriteStream( this.archivePath );

			const archive = archiver( 'zip', {
				zlib: { level: 9 },
			} );

			output.on( 'close', () => {
				this.logger.reportProgress( Status.ARCHIVE_CREATED );
				resolve( archive );
			} );

			archive.on( 'error', ( err: Error ) => {
				this.logger.reportError( err.message );
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
		this.logger.reportProgress( Status.ARCHIVE_UPLOADED );
		return response.json();
	}

	async cleanup() {
		fs.unlinkSync( this.archivePath );
	}
}
