import { EventEmitter } from 'events';
import fs from 'fs';
import fsPromises from 'fs/promises';
import os from 'os';
import path from 'path';
import archiver from 'archiver';
import { ARCHIVER_OPTIONS } from 'src/constants';
import { getSiteUrl } from 'src/lib/get-site-url';
import { ExportEvents } from 'src/lib/import-export/export/events';
import {
	exportDatabaseToFile,
	exportDatabaseToMultipleFiles,
} from 'src/lib/import-export/export/export-database';
import { generateBackupFilename } from 'src/lib/import-export/export/generate-backup-filename';
import {
	ExportOptions,
	BackupContents,
	Exporter,
	BackupCreateProgressEventData,
	BackupContentsCategory,
	StudioJson,
} from 'src/lib/import-export/export/types';
import { getWordPressVersionFromInstallation } from 'src/lib/wp-versions';
import { SiteServer } from 'src/site-server';

export class DefaultExporter extends EventEmitter implements Exporter {
	private archive!: archiver.Archiver;
	private backup: BackupContents;
	private readonly options: ExportOptions;
	private siteFiles: string[];
	private readonly pathsToExclude = [
		'wp-content/mu-plugins/sqlite-database-integration',
		'wp-content/mu-plugins/0-32bit-integer-warnings.php',
		'wp-content/mu-plugins/0-allowed-redirect-hosts.php',
		'wp-content/mu-plugins/0-check-theme-availability.php',
		'wp-content/mu-plugins/0-deactivate-jetpack-modules.php',
		'wp-content/mu-plugins/0-dns-functions.php',
		'wp-content/mu-plugins/0-permalinks.php',
		'wp-content/mu-plugins/0-wp-config-constants-polyfill.php',
		'wp-content/mu-plugins/0-sqlite.php',
		'wp-content/mu-plugins/0-thumbnails.php',
	];

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
				muPlugins: [],
				fonts: [],
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
			{ path: [ 'wp-content' ], isDir: true },
			{ path: [ 'wp-includes' ], isDir: true },
			{ path: 'wp-load.php', isDir: false },
			{ path: 'wp-config.php', isDir: false },
		];

		this.siteFiles = await this.getSiteFiles();

		return requiredPaths.every( ( requiredPath ) =>
			this.siteFiles.some( ( file ) => {
				const relativePath = path.relative( this.options.site.path, file );
				const relativePathItems = relativePath.split( path.sep );
				return requiredPath.isDir
					? ( requiredPath.path as string[] ).every(
							( path, index ) => path === relativePathItems[ index ]
					  )
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
			this.archive.file( studioJsonPath, { name: 'meta.json' } );
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
		const format = isZip ? 'zip' : 'tar';
		return archiver( format, ARCHIVER_OPTIONS[ format ] );
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
		const categories = (
			[ 'uploads', 'plugins', 'themes', 'muPlugins', 'fonts' ] as BackupContentsCategory[]
		 ).filter( ( category ) => this.options.includes[ category ] );
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
			muPlugins: this.backup.wpContent.muPlugins.length,
			fonts: this.backup.wpContent.fonts.length,
		} );
	}

	private async addDatabase(): Promise< void > {
		if ( ! this.options.includes.database ) {
			return;
		}

		this.emit( ExportEvents.DATABASE_EXPORT_START );
		const tmpFolder = await fsPromises.mkdtemp( path.join( os.tmpdir(), 'studio_export' ) );

		if ( this.options.splitDatabaseDumpByTable ) {
			const sqlFiles = await exportDatabaseToMultipleFiles( this.options.site, tmpFolder );
			sqlFiles.forEach( ( file ) =>
				this.archive.file( file, { name: `sql/${ path.basename( file ) }` } )
			);
			this.backup.sqlFiles.push( ...sqlFiles );
		} else {
			const fileName = `${ generateBackupFilename( 'db-export' ) }.sql`;
			const sqlDumpPath = path.join( tmpFolder, fileName );
			await exportDatabaseToFile( this.options.site, sqlDumpPath );
			this.archive.file( sqlDumpPath, { name: `sql/${ fileName }` } );
			this.backup.sqlFiles.push( sqlDumpPath );
		}

		this.emit( ExportEvents.DATABASE_EXPORT_COMPLETE );
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
			const filePath = path.join( directoryContent.path, directoryContent.name );
			const relativePath = path.relative( this.options.site.path, filePath );
			const isExcluded = this.pathsToExclude.some( ( pathToExclude ) =>
				relativePath.startsWith( path.normalize( pathToExclude ) )
			);
			if ( isExcluded ) {
				return files;
			}
			if ( directoryContent.isFile() ) {
				files.push( filePath );
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
				muPlugins: [],
				fonts: [],
			},
		};

		const siteFiles = await this.getSiteFiles();
		siteFiles.forEach( ( file ) => {
			const relativePath = path.relative( options.site.path, file );
			const relativePathItems = relativePath.split( path.sep );
			const [ wpContent, wpContentDirectory ] = relativePathItems;
			if ( path.basename( file ) === 'wp-config.php' ) {
				backupContents.wpConfigFile = file;
			} else if ( wpContent === 'wp-content' ) {
				if (
					wpContentDirectory === 'uploads' ||
					wpContentDirectory === 'plugins' ||
					wpContentDirectory === 'themes' ||
					wpContentDirectory === 'fonts'
				) {
					backupContents.wpContent[ wpContentDirectory as BackupContentsCategory ].push( file );
				} else if ( wpContentDirectory === 'mu-plugins' ) {
					backupContents.wpContent.muPlugins.push( file );
				}
			}
		} );

		return backupContents;
	}

	private async createStudioJsonFile(): Promise< string > {
		const wpVersion = await getWordPressVersionFromInstallation( this.options.site.path );
		const studioJson: StudioJson = {
			siteUrl: getSiteUrl( this.options.site ),
			phpVersion: this.options.phpVersion,
			wordpressVersion: wpVersion ? wpVersion : '',
			plugins: [],
			themes: [],
		};

		studioJson.plugins = await this.getSitePlugins( this.options.site.id );
		studioJson.themes = await this.getSiteThemes( this.options.site.id );

		const tempDir = await fsPromises.mkdtemp( path.join( os.tmpdir(), 'studio-export-' ) );
		const studioJsonPath = path.join( tempDir, 'meta.json' );
		await fsPromises.writeFile( studioJsonPath, JSON.stringify( studioJson, null, 2 ) );
		return studioJsonPath;
	}

	private async getSitePlugins( site_id: string ) {
		const server = SiteServer.get( site_id );

		if ( ! server ) {
			return [];
		}

		const { stderr, stdout } = await server.executeWpCliCommand(
			'plugin list --status=active,inactive --fields=name,status,version --format=json',
			{
				skipPluginsAndThemes: true,
			}
		);

		if ( stderr ) {
			console.error( `Could not get information about plugins: ${ stderr }` );
			throw new Error(
				'Could not get information about installed plugins to create meta.json file.'
			);
		}

		try {
			return JSON.parse( stdout );
		} catch ( error ) {
			console.error( `Could not parse plugins list. The WP CLI output: ${ stdout }` );
			throw new Error(
				'Could not parse information about installed plugins to create meta.json file.'
			);
		}
	}

	private async getSiteThemes( site_id: string ) {
		const server = SiteServer.get( site_id );

		if ( ! server ) {
			return [];
		}

		const { stderr, stdout } = await server.executeWpCliCommand(
			'theme list --fields=name,status,version --format=json',
			{
				skipPluginsAndThemes: true,
			}
		);

		if ( stderr ) {
			console.error( `Could not get information about themes: ${ stderr }` );
			throw new Error(
				'Could not get information about installed themes to create meta.json file.'
			);
		}

		try {
			return JSON.parse( stdout );
		} catch ( error ) {
			console.error( `Could not parse themes list. The WP CLI output: ${ stdout }` );
			throw new Error(
				'Could not parse information about installed themes to create meta.json file.'
			);
		}
	}
}
