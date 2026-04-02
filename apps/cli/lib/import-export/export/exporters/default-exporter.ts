import { EventEmitter } from 'events';
import fs from 'fs';
import fsPromises from 'fs/promises';
import os from 'os';
import path from 'path';
import { ARCHIVER_OPTIONS, DEFAULT_PHP_VERSION } from '@studio/common/constants';
import { parseJsonFromPhpOutput } from '@studio/common/lib/php-output-parser';
import {
	hasDefaultDbBlock,
	removeDbConstants,
} from '@studio/common/lib/remove-default-db-constants';
import archiver from 'archiver';
import { getSiteUrl } from 'cli/lib/cli-config/sites';
import { getWordPressVersionFromInstallation } from 'cli/lib/dependency-management/wordpress';
import { runWpCliCommand } from 'cli/lib/run-wp-cli-command';
import { ExportEvents } from '../events';
import { exportDatabaseToFile, exportDatabaseToMultipleFiles } from '../export-database';
import { generateBackupFilename } from '../generate-backup-filename';
import {
	ExportOptions,
	BackupContents,
	Exporter,
	BackupCreateProgressEventData,
	StudioJson,
} from '../types';

export class DefaultExporter extends EventEmitter implements Exporter {
	private archiveBuilder!: archiver.Archiver;
	private backup: BackupContents;
	private readonly options: ExportOptions;

	isExactPathExcluded( pathToCheck: string ) {
		const PATHS_TO_EXCLUDE = [
			'wp-content/mu-plugins/sqlite-database-integration',
			'wp-content/database',
			'wp-content/db.php',
			'wp-content/debug.log',
			'wp-content/mu-plugins/0-allowed-redirect-hosts.php',
			'wp-content/mu-plugins/0-check-theme-availability.php',
			'wp-content/mu-plugins/0-deactivate-jetpack-modules.php',
			'wp-content/mu-plugins/0-dns-functions.php',
			'wp-content/mu-plugins/0-permalinks.php',
			'wp-content/mu-plugins/0-wp-config-constants-polyfill.php',
			'wp-content/mu-plugins/0-sqlite.php',
			'wp-content/mu-plugins/0-thumbnails.php',
			'wp-content/mu-plugins/0-https-for-reverse-proxy.php',
			'wp-content/mu-plugins/0-sqlite-command.php',
		];

		return PATHS_TO_EXCLUDE.some( ( pathToExclude ) =>
			pathToCheck.startsWith( path.normalize( pathToExclude ) )
		);
	}

	// Look for disallowed directory names in a given path. If found, determine whether that part of
	// the path is a directory or not.
	isPathExcludedByPattern( pathToCheck: string ) {
		const DIRECTORY_NAMES_TO_EXCLUDE = [ '.git', 'node_modules', 'cache' ];
		const pathParts = pathToCheck.split( path.sep );

		for ( const directoryName of DIRECTORY_NAMES_TO_EXCLUDE ) {
			if ( ! pathParts.includes( directoryName ) ) {
				continue;
			}
			const offenderIndex = pathToCheck.lastIndexOf( directoryName );
			const offenderPath = pathToCheck.substring( 0, offenderIndex + directoryName.length );
			try {
				const stat = fs.statSync( offenderPath );
				return stat.isDirectory();
			} catch ( error ) {
				return false;
			}
		}

		return false;
	}

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
			await this.addWpContent();
			await this.addDatabase();
			const studioJsonPath = await this.createStudioJsonFile();
			this.archiveBuilder.file( studioJsonPath, { name: 'meta.json' } );
			await this.archiveBuilder.finalize();
			this.emit( ExportEvents.BACKUP_CREATE_COMPLETE );
			await archiveClosedPromise;
			this.emit( ExportEvents.EXPORT_COMPLETE );
		} catch ( error ) {
			this.archiveBuilder.abort();
			this.emit( ExportEvents.EXPORT_ERROR, error );
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
			const content = fs.readFileSync( wpConfigPath, 'utf-8' );
			if ( hasDefaultDbBlock( content ) ) {
				const modifiedContent = removeDbConstants( content );
				fs.writeFileSync( wpConfigPath, modifiedContent, 'utf-8' );
			}
			this.archiveBuilder.file( wpConfigPath, {
				name: 'wp-config.php',
			} );
		}
	}

	private async addWpContent(): Promise< void > {
		if ( ! this.options.includes.wpContent ) {
			return;
		}
		this.emit( ExportEvents.WP_CONTENT_EXPORT_START );

		let pathsToArchive = this.options.specificSelectionPaths;
		if ( ! pathsToArchive ) {
			// Read the wp-content directory and get all the paths to be archived
			pathsToArchive = fs.readdirSync( path.join( this.options.site.path, 'wp-content' ) );
		}

		if ( Array.isArray( pathsToArchive ) ) {
			for ( const itemPath of pathsToArchive ) {
				const fullPath = path.join( this.options.site.path, 'wp-content', itemPath );
				const archivePath = path.join( 'wp-content', itemPath );

				if ( ! fs.existsSync( fullPath ) ) {
					continue;
				}

				const stat = await fsPromises.stat( fullPath );
				if ( stat.isDirectory() ) {
					this.archiveBuilder.directory( fullPath, archivePath, ( entry ) => {
						const entryPathRelativeToArchiveRoot = path.join( archivePath, entry.name );
						const fullEntryPathOnDisk = path.join(
							this.options.site.path,
							entryPathRelativeToArchiveRoot
						);
						if (
							this.isExactPathExcluded( entryPathRelativeToArchiveRoot ) ||
							this.isPathExcludedByPattern( fullEntryPathOnDisk )
						) {
							return false;
						}
						return entry;
					} );
				} else {
					if ( this.isExactPathExcluded( archivePath ) ) {
						continue;
					}
					this.archiveBuilder.file( fullPath, { name: archivePath } );
				}
			}
		}

		this.emit( ExportEvents.WP_CONTENT_EXPORT_COMPLETE );
	}

	private async addDatabase(): Promise< void > {
		if ( ! this.options.includes.database ) {
			return;
		}

		this.emit( ExportEvents.DATABASE_EXPORT_START );
		const tmpFolder = await fsPromises.mkdtemp( path.join( os.tmpdir(), 'studio_export' ) );

		if ( this.options.splitDatabaseDumpByTable ) {
			const sqlFiles = await exportDatabaseToMultipleFiles( this.options.site.path, tmpFolder );
			sqlFiles.forEach( ( file ) =>
				this.archiveBuilder.file( file, { name: `sql/${ path.basename( file ) }` } )
			);
			this.backup.sqlFiles.push( ...sqlFiles );
		} else {
			const fileName = `${ generateBackupFilename( 'db-export' ) }.sql`;
			const sqlDumpPath = path.join( tmpFolder, fileName );
			await exportDatabaseToFile( this.options.site.path, sqlDumpPath );
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

		const [ plugins, themes ] = await Promise.all( [
			this.getSitePlugins( this.options.site.path ),
			this.getSiteThemes( this.options.site.path ),
		] );

		studioJson.plugins = plugins;
		studioJson.themes = themes;

		const tempDir = await fsPromises.mkdtemp( path.join( os.tmpdir(), 'studio-export-' ) );
		const studioJsonPath = path.join( tempDir, 'meta.json' );
		await fsPromises.writeFile( studioJsonPath, JSON.stringify( studioJson, null, 2 ) );
		return studioJsonPath;
	}

	private async getSitePlugins( siteFolder: string ) {
		await using command = await runWpCliCommand( siteFolder, DEFAULT_PHP_VERSION, [
			'plugin',
			'list',
			'--status=active,inactive',
			'--fields=name,status,version',
			'--format=json',
			'--skip-plugins',
			'--skip-themes',
		] );

		const exitCode = await command.response.exitCode;
		if ( exitCode !== 0 ) {
			throw new Error( `Failed to get site plugins` );
		}

		const stdout = await command.response.stdoutText;
		const stderr = await command.response.stderrText;

		try {
			return parseJsonFromPhpOutput( stdout );
		} catch ( error ) {
			if ( stderr ) {
				console.error( `Could not get information about plugins: ${ stderr }` );
			} else {
				console.error( `Could not parse plugins list. The WP CLI output: ${ stdout }` );
			}

			throw new Error(
				'Could not parse information about installed plugins to create meta.json file.'
			);
		}
	}

	private async getSiteThemes( siteFolder: string ) {
		await using command = await runWpCliCommand( siteFolder, DEFAULT_PHP_VERSION, [
			'theme',
			'list',
			'--fields=name,status,version',
			'--format=json',
			'--skip-plugins',
			'--skip-themes',
		] );

		const exitCode = await command.response.exitCode;
		if ( exitCode !== 0 ) {
			throw new Error( `Failed to get site plugins` );
		}

		const stdout = await command.response.stdoutText;
		const stderr = await command.response.stderrText;

		try {
			return parseJsonFromPhpOutput( stdout );
		} catch ( error ) {
			if ( stderr ) {
				console.error( `Could not get information about themes: ${ stderr }` );
			} else {
				console.error( `Could not parse themes list. The WP CLI output: ${ stdout }` );
			}

			throw new Error(
				'Could not parse information about installed themes to create meta.json file.'
			);
		}
	}
}
