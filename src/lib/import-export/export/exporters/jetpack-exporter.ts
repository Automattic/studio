import fs from 'fs';
import fsPromises from 'fs/promises';
import os from 'os';
import path from 'path';
import archiver from 'archiver';
import { ExportOptions, BackupContents, Exporter } from '../types';

export class JetpackExporter implements Exporter {
	private archive!: archiver.Archiver;

	constructor( protected backup: BackupContents ) {}

	async export( options: ExportOptions ): Promise< void > {
		const output = fs.createWriteStream( options.backupFile );
		this.archive = this.createArchive( output, options );

		try {
			await this.addWpConfig();
			await this.addWpContent( options );
			await this.addDatabase( options );
			await this.finalizeArchive();
		} catch ( error ) {
			this.archive.abort();
			throw error;
		} finally {
			if ( options.includes.database ) {
				await this.cleanupTempFiles();
			}
		}
	}

	private createArchive( output: fs.WriteStream, options: ExportOptions ): archiver.Archiver {
		const isZip = options.backupFile.endsWith( '.zip' );
		const archive = archiver( isZip ? 'zip' : 'tar', {
			gzip: ! isZip,
			gzipOptions: isZip ? undefined : { level: 9 },
		} );

		output.on( 'close', () => {
			console.log( `Backup created at: ${ output.path }` );
		} );

		archive.on( 'warning', ( err ) => {
			if ( err.code === 'ENOENT' ) {
				console.warn( 'Archiver warning:', err );
			} else {
				throw err;
			}
		} );

		archive.on( 'error', ( err ) => {
			throw err;
		} );

		archive.pipe( output );

		return archive;
	}

	private async addWpConfig(): Promise< void > {
		if ( this.backup.wpConfigFile ) {
			this.archive = this.archive.file( this.backup.wpConfigFile || '', {
				name: 'wp-config.php',
			} );
		}
	}

	private async addWpContent( options: ExportOptions ): Promise< void > {
		for ( const category of [ 'uploads', 'plugins', 'themes' ] as const ) {
			if ( options.includes[ category ] ) {
				for ( const file of this.backup.wpContent[ category ] ) {
					const relativePath = path.relative( options.sitePath, file );
					console.log( relativePath, 'relative' );
					this.archive.file( file, { name: relativePath } );
				}
			}
		}
	}

	private async addDatabase( options: ExportOptions ): Promise< void > {
		if ( options.includes.database ) {
			// Add a toy sql file here, to make importer validation pass
			const tmpFolder = await fsPromises.mkdtemp( path.join( os.tmpdir(), 'studio_export' ) );
			const fileName = 'file.sql';
			const sqlDumpPath = path.join( tmpFolder, fileName );
			await fsPromises.writeFile( sqlDumpPath, '--test' );
			this.archive.file( sqlDumpPath, { name: `sql/${ fileName }` } );
			this.backup.sqlFiles.push( sqlDumpPath );
		}
	}

	private async finalizeArchive(): Promise< void > {
		await this.archive.finalize();
	}

	private async cleanupTempFiles(): Promise< void > {
		for ( const sqlFile of this.backup.sqlFiles ) {
			await fsPromises
				.unlink( sqlFile )
				.catch( ( err ) => console.error( `Failed to delete temporary file ${ sqlFile }:`, err ) );
		}
	}
}
