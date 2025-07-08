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
	private archiveBuilder!: archiver.Archiver;
	private backup: BackupContents;
	private readonly options: ExportOptions;
	private readonly pathsToExclude = [
		'wp-content/mu-plugins/sqlite-database-integration',
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
		this.backup = {
			backupFile: options.backupFile,
			sqlFiles: [],
		};
	}
	async canHandle(): Promise< boolean > {
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

		try {
			for ( const requiredPath of requiredPaths ) {
				const stats = await fsPromises.stat(
					path.join( this.options.site.path, requiredPath.path )
				);
				if ( requiredPath.isDir && ! stats.isDirectory() ) {
					return false;
				}
				if ( ! requiredPath.isDir && ! stats.isFile() ) {
					return false;
				}
			}
			return true;
		} catch ( error ) {
			return false;
		}
	}

	async export(): Promise< void > {
		this.emit( ExportEvents.EXPORT_START );
		const output = fs.createWriteStream( this.options.backupFile );
		this.archiveBuilder = this.createArchiveBuilder();

		const archiveClosedPromise = this.setupArchiveListeners( output );

		this.archiveBuilder.pipe( output );

		try {
			this.addWpConfig();
			this.addWpContent();
			await this.addDatabase();
			const studioJsonPath = await this.createStudioJsonFile();
			this.archiveBuilder.file( studioJsonPath, { name: 'meta.json' } );
			await this.archiveBuilder.finalize();
			this.emit( ExportEvents.BACKUP_CREATE_COMPLETE );
			await archiveClosedPromise;
			this.emit( ExportEvents.EXPORT_COMPLETE );
		} catch ( error ) {
			this.archiveBuilder.abort();
			this.emit( ExportEvents.EXPORT_ERROR );
			throw error;
		} finally {
			if ( this.options.includes.database ) {
				await this.cleanupTempFiles();
			}
		}
	}

	private createArchiveBuilder(): archiver.Archiver {
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

			this.archiveBuilder.on( 'warning', ( err ) => {
				if ( err.code === 'ENOENT' ) {
					console.warn( 'Archiver warning:', err );
				} else {
					reject( err );
				}
			} );
			this.archiveBuilder.on( 'progress', ( progress ) => {
				this.emit( ExportEvents.BACKUP_CREATE_PROGRESS, {
					progress,
				} as BackupCreateProgressEventData );
			} );

			this.archiveBuilder.on( 'error', reject );
		} );
	}

	private addWpConfig(): void {
		const wpConfigPath = path.join( this.options.site.path, 'wp-config.php' );
		if ( fs.existsSync( wpConfigPath ) ) {
			this.archiveBuilder.file( wpConfigPath, {
				name: 'wp-config.php',
			} );
		}
	}

	private addWpContent(): void {
		const categories = (
			[ 'uploads', 'plugins', 'themes', 'muPlugins', 'fonts' ] as BackupContentsCategory[]
		 ).filter( ( category ) => this.options.includes[ category ] );
		this.emit( ExportEvents.WP_CONTENT_EXPORT_START );
		for ( const category of categories ) {
			const folderName = category === 'muPlugins' ? 'mu-plugins' : category;
			const absolutePath = path.join( this.options.site.path, 'wp-content', folderName );
			const archivePath = path.relative( this.options.site.path, absolutePath );
			const partialFolderItems = this.getCategorySelections( category );

			if ( partialFolderItems ) {
				for ( const itemName of partialFolderItems ) {
					const itemPath = path.join( absolutePath, itemName );
					const itemArchivePath = path.join( archivePath, itemName );

					if ( fs.existsSync( itemPath ) ) {
						const stat = fs.statSync( itemPath );
						if ( stat.isDirectory() ) {
							this.archiveBuilder.directory( itemPath, itemArchivePath, ( entry ) => {
								if ( entry.name.includes( '.git' ) || entry.name.includes( 'node_modules' ) ) {
									return false;
								}
								return entry;
							} );
						} else {
							this.archiveBuilder.file( itemPath, { name: itemArchivePath } );
						}
					}
				}
			} else {
				this.archiveBuilder.directory( absolutePath, archivePath, ( entry ) => {
					const fullArchivePath = path.join( archivePath, entry.name );
					const isExcluded = this.pathsToExclude.some( ( pathToExclude ) =>
						fullArchivePath.startsWith( path.normalize( pathToExclude ) )
					);
					if (
						isExcluded ||
						entry.name.includes( '.git' ) ||
						entry.name.includes( 'node_modules' )
					) {
						return false;
					}
					return entry;
				} );
			}

			this.emit( ExportEvents.WP_CONTENT_EXPORT_PROGRESS, { directory: absolutePath } );
		}
		this.emit( ExportEvents.WP_CONTENT_EXPORT_COMPLETE );
	}

	private getCategorySelections( category: BackupContentsCategory ): string[] | null {
		if ( ! this.options.specificSelections ) {
			return null;
		}

		switch ( category ) {
			case 'plugins':
				return this.options.specificSelections?.plugins || null;
			case 'themes':
				return this.options.specificSelections?.themes || null;
			case 'uploads':
				return this.options.specificSelections?.uploads || null;
			case 'muPlugins':
				return this.options.specificSelections?.muPlugins || null;
			case 'fonts':
				return this.options.specificSelections?.fonts || null;
			default:
				return null;
		}
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
				this.archiveBuilder.file( file, { name: `sql/${ path.basename( file ) }` } )
			);
			this.backup.sqlFiles.push( ...sqlFiles );
		} else {
			const fileName = `${ generateBackupFilename( 'db-export' ) }.sql`;
			const sqlDumpPath = path.join( tmpFolder, fileName );
			await exportDatabaseToFile( this.options.site, sqlDumpPath );
			this.archiveBuilder.file( sqlDumpPath, { name: `sql/${ fileName }` } );
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
