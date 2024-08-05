import { EventEmitter } from 'events';
import fs from 'fs';
import fsPromises from 'fs/promises';
import os from 'os';
import path from 'path';
import archiver from 'archiver';
import { getWordPressVersionFromInstallation } from '../../../../lib/wp-versions';
import { ExportEvents } from '../events';
import { exportDatabaseToFile } from '../export-database';
import { generateBackupFilename } from '../generate-backup-filename';
import {
	ExportOptions,
	BackupContents,
	Exporter,
	BackupCreateProgressEventData,
	BackupContentsCategory,
} from '../types';

export class DefaultExporter extends EventEmitter implements Exporter {
	private archive!: archiver.Archiver;
	private backup: BackupContents;
	private readonly options: ExportOptions;
	private siteFiles: string[];

	constructor( options: ExportOptions ) {
		super();
		this.options = options;
		this.siteFiles = [];
		this.backup = {
			backupFile: options.backupFile,
			sqlFiles: [],
			wpContent: {
				uploads: [],
				plugins: [],
				themes: [],
			},
		};
	}
	async canHandle(): Promise< boolean > {
		// Check for supported extension
		const supportedExtension = [ 'tar.gz', 'tzg', 'zip' ].find( ( ext ) =>
			this.options.backupFile.endsWith( ext )
		);

		if ( ! supportedExtension ) {
			return false;
		}

		const requiredPaths = [
			{ path: 'wp-content', isDir: true },
			{ path: 'wp-includes', isDir: true },
			{ path: 'wp-load.php', isDir: false },
			{ path: 'wp-config.php', isDir: false },
		];

		this.siteFiles = await this.getSiteFiles();

		return requiredPaths.every( ( requiredPath ) =>
			this.siteFiles.some( ( file ) => {
				const relativePath = path.relative( this.options.site.path, file );
				return requiredPath.isDir
					? relativePath.startsWith( requiredPath.path )
					: relativePath === requiredPath.path;
			} )
		);
	}

	async export(): Promise< void > {
		this.emit( ExportEvents.EXPORT_START );
		this.backup = await this.getBackupContents();
		const output = fs.createWriteStream( this.options.backupFile );
		this.archive = this.createArchive();

		const archiveClosedPromise = this.setupArchiveListeners( output );

		this.archive.pipe( output );

		try {
			this.addWpConfig();
			this.addWpContent();
			await this.addDatabase();
			const studioJsonPath = await this.createStudioJsonFile();
			this.archive.file( studioJsonPath, { name: 'studio.json' } );
			await this.archive.finalize();
			this.emit( ExportEvents.BACKUP_CREATE_COMPLETE );
			await archiveClosedPromise;
			this.emit( ExportEvents.EXPORT_COMPLETE );
		} catch ( error ) {
			this.archive.abort();
			this.emit( ExportEvents.EXPORT_ERROR );
			throw error;
		} finally {
			if ( this.options.includes.database ) {
				await this.cleanupTempFiles();
			}
		}
	}

	private createArchive(): archiver.Archiver {
		this.emit( ExportEvents.BACKUP_CREATE_START );
		const isZip = this.options.backupFile.endsWith( '.zip' );
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

	private addWpContent(): void {
		const categories = ( [ 'uploads', 'plugins', 'themes' ] as BackupContentsCategory[] ).filter(
			( category ) => this.options.includes[ category ]
		);
		this.emit( ExportEvents.WP_CONTENT_EXPORT_START );
		for ( const category of categories ) {
			for ( const file of this.backup.wpContent[ category ] ) {
				const relativePath = path.relative( this.options.site.path, file );
				this.archive.file( file, { name: relativePath } );
				this.emit( ExportEvents.WP_CONTENT_EXPORT_PROGRESS, { file: relativePath } );
			}
		}
		this.emit( ExportEvents.WP_CONTENT_EXPORT_COMPLETE, {
			uploads: this.backup.wpContent.uploads.length,
			plugins: this.backup.wpContent.plugins.length,
			themes: this.backup.wpContent.themes.length,
		} );
	}

	private async addDatabase(): Promise< void > {
		if ( this.options.includes.database ) {
			this.emit( ExportEvents.DATABASE_EXPORT_START );
			const tmpFolder = await fsPromises.mkdtemp( path.join( os.tmpdir(), 'studio_export' ) );
			const fileName = `${ generateBackupFilename( 'db-export' ) }.sql`;
			const sqlDumpPath = path.join( tmpFolder, fileName );
			await exportDatabaseToFile( this.options.site, sqlDumpPath );
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

	private async getSiteFiles(): Promise< string[] > {
		if ( this.siteFiles.length ) {
			return this.siteFiles;
		}

		const directoryContents = await fsPromises.readdir( this.options.site.path, {
			recursive: true,
			withFileTypes: true,
		} );

		return directoryContents.reduce< string[] >( ( files: string[], directoryContent ) => {
			if ( directoryContent.isFile() ) {
				files.push( path.join( directoryContent.path, directoryContent.name ) );
			}
			return files;
		}, [] );
	}

	private async getBackupContents(): Promise< BackupContents > {
		const options = this.options;
		const backupContents: BackupContents = {
			backupFile: options.backupFile,
			sqlFiles: [],
			wpContent: {
				uploads: [],
				plugins: [],
				themes: [],
			},
		};

		const siteFiles = await this.getSiteFiles();
		siteFiles.forEach( ( file ) => {
			const relativePath = path.relative( options.site.path, file );
			if ( path.basename( file ) === 'wp-config.php' ) {
				backupContents.wpConfigFile = file;
			} else if ( relativePath.startsWith( 'wp-content/uploads/' ) && options.includes.uploads ) {
				backupContents.wpContent.uploads.push( file );
			} else if ( relativePath.startsWith( 'wp-content/plugins/' ) && options.includes.plugins ) {
				backupContents.wpContent.plugins.push( file );
			} else if ( relativePath.startsWith( 'wp-content/themes/' ) && options.includes.themes ) {
				backupContents.wpContent.themes.push( file );
			}
		} );

		return backupContents;
	}

	private async createStudioJsonFile(): Promise< string > {
		const wpVersion = await getWordPressVersionFromInstallation( this.options.site.path );
		const studioJson: { phpVersion: string; wordpressVersion?: string } = {
			phpVersion: this.options.phpVersion,
		};
		if ( wpVersion ) {
			studioJson.wordpressVersion = wpVersion;
		}
		const tempDir = await fsPromises.mkdtemp( path.join( os.tmpdir(), 'studio-export-' ) );
		const studioJsonPath = path.join( tempDir, 'studio.json' );
		await fsPromises.writeFile( studioJsonPath, JSON.stringify( studioJson, null, 2 ) );
		return studioJsonPath;
	}
}
