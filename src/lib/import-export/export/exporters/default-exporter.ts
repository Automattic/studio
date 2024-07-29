import { EventEmitter } from 'events';
import fs from 'fs';
import fsPromises from 'fs/promises';
import os from 'os';
import path from 'path';
import archiver from 'archiver';
import { ExportEvents } from '../events';
import { ExportOptions, BackupContents, Exporter, BackupCreateProgressEventData } from '../types';

export class DefaultExporter extends EventEmitter implements Exporter {
	private archive!: archiver.Archiver;

	constructor( protected backup: BackupContents ) {
		super();
	}

	async export( options: ExportOptions ): Promise< void > {
		this.emit( ExportEvents.EXPORT_START );

		const output = fs.createWriteStream( options.backupFile );
		this.archive = this.createArchive( options );

		const archiveClosedPromise = this.setupArchiveListeners( output );

		this.archive.pipe( output );

		try {
			this.addWpConfig();
			this.addWpContent( options );
			await this.addDatabase( options );
			await this.archive.finalize();
			this.emit( ExportEvents.BACKUP_CREATE_COMPLETE );
			await archiveClosedPromise;
			this.emit( ExportEvents.EXPORT_COMPLETE );
		} catch ( error ) {
			this.archive.abort();
			this.emit( ExportEvents.EXPORT_ERROR );
			throw error;
		} finally {
			if ( options.includes.database ) {
				await this.cleanupTempFiles();
			}
		}
	}

	private createArchive( options: ExportOptions ): archiver.Archiver {
		this.emit( ExportEvents.BACKUP_CREATE_START );
		const isZip = options.backupFile.endsWith( '.zip' );
		return archiver( isZip ? 'zip' : 'tar', {
			gzip: ! isZip,
			gzipOptions: isZip ? undefined : { level: 9 },
		} );
	}

	private setupArchiveListeners( output: fs.WriteStream ): Promise< void > {
		return new Promise( ( resolve, reject ) => {
			output.on( 'close', () => {
				console.log( `Backup created at: ${ output.path }` );
				resolve();
			} );

			this.archive.on( 'warning', ( err ) => {
				if ( err.code === 'ENOENT' ) {
					console.warn( 'Archiver warning:', err );
				} else {
					reject( err );
				}
			} );
			this.archive.on( 'progress', ( progress ) => {
				this.emit( ExportEvents.BACKUP_CREATE_PROGRESS, {
					progress,
				} as BackupCreateProgressEventData );
			} );

			this.archive.on( 'error', reject );
		} );
	}

	private addWpConfig(): void {
		if ( this.backup.wpConfigFile ) {
			this.archive.file( this.backup.wpConfigFile, { name: 'wp-config.php' } );
		}
	}

	private addWpContent( options: ExportOptions ): void {
		for ( const category of [ 'uploads', 'plugins', 'themes' ] as const ) {
			if ( options.includes[ category ] ) {
				for ( const file of this.backup.wpContent[ category ] ) {
					const relativePath = path.relative( options.sitePath, file );
					this.archive.file( file, { name: relativePath } );
					this.emit( ExportEvents.WP_CONTENT_EXPORT_PROGRESS, { file: relativePath } );
				}
			}
		}
		this.emit( ExportEvents.WP_CONTENT_EXPORT_COMPLETE, {
			uploads: this.backup.wpContent.uploads.length,
			plugins: this.backup.wpContent.plugins.length,
			themes: this.backup.wpContent.themes.length,
		} );
	}

	private async addDatabase( options: ExportOptions ): Promise< void > {
		if ( options.includes.database ) {
			this.emit( ExportEvents.DATABASE_EXPORT_START );
			// Add a toy sql file here, to make importer validation pass
			// This will be implemented in a different ticket
			const tmpFolder = await fsPromises.mkdtemp( path.join( os.tmpdir(), 'studio_export' ) );
			const fileName = 'file.sql';
			const sqlDumpPath = path.join( tmpFolder, fileName );
			await fsPromises.writeFile( sqlDumpPath, '--test' );
			this.archive.file( sqlDumpPath, { name: `sql/${ fileName }` } );
			this.backup.sqlFiles.push( sqlDumpPath );
			this.emit( ExportEvents.DATABASE_EXPORT_COMPLETE );
		}
	}

	private async cleanupTempFiles(): Promise< void > {
		for ( const sqlFile of this.backup.sqlFiles ) {
			await fsPromises
				.unlink( sqlFile )
				.catch( ( err ) => console.error( `Failed to delete temporary file ${ sqlFile }:`, err ) );
		}
	}
}
