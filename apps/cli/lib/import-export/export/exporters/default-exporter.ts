import fs from 'fs';
import fsPromises from 'fs/promises';
import os from 'os';
import path from 'path';
import { ARCHIVER_OPTIONS, DEFAULT_PHP_VERSION } from '@studio/common/constants';
import { generateBackupFilename } from '@studio/common/lib/generate-backup-filename';
import { createExportErrorPayload, ExportEvents } from '@studio/common/lib/import-export-events';
import { parseJsonFromPhpOutput } from '@studio/common/lib/php-output-parser';
import {
	hasDefaultDbBlock,
	removeDbConstants,
} from '@studio/common/lib/remove-default-db-constants';
import { __, sprintf } from '@wordpress/i18n';
import { Archiver, TarArchive, ZipArchive } from 'archiver';
import { glob } from 'glob';
import { getSiteUrl } from 'cli/lib/cli-config/sites';
import { getWordPressVersionFromInstallation } from 'cli/lib/dependency-management/wordpress';
import { runWpCliCommand } from 'cli/lib/run-wp-cli-command';
import { ensureSqliteIntegrationForImportedSite } from 'cli/lib/sqlite-integration';
import { LoggerError } from 'cli/logger';
import { ImportExportEventEmitter } from '../../events';
import { exportDatabaseToFile, exportDatabaseToMultipleFiles } from '../export-database';
import {
	ExportOptions,
	BackupContents,
	Exporter,
	StudioJson,
	StudioJsonPluginOrTheme,
} from '../types';
import { isExactPathExcluded, isPathExcludedByPattern } from './path-exclusions';
import type { SiteData } from 'cli/lib/cli-config/core';

export class DefaultExporter extends ImportExportEventEmitter implements Exporter {
	private archiveBuilder!: Archiver;
	private backup: BackupContents;
	private readonly options: ExportOptions;

	isExactPathExcluded( pathToCheck: string ) {
		return isExactPathExcluded( pathToCheck );
	}

	// Look for disallowed directory names in a given path. If found, determine whether that part of
	// the path is a directory or not.
	isPathExcludedByPattern( pathToCheck: string ) {
		return isPathExcludedByPattern( pathToCheck );
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
			this.emit( ExportEvents.EXPORT_ERROR, createExportErrorPayload( error ) );
			throw error;
		} finally {
			if ( this.options.includes.database ) {
				await this.cleanupTempFiles();
			}
		}
	}

	private createArchiveBuilder(): Archiver {
		this.emit( ExportEvents.BACKUP_CREATE_START );

		return this.options.backupFile.endsWith( '.zip' )
			? new ZipArchive( ARCHIVER_OPTIONS.zip )
			: new TarArchive( ARCHIVER_OPTIONS.tar );
	}

	private setupArchiveListeners( output: fs.WriteStream ): Promise< void > {
		return new Promise( ( resolve, reject ) => {
			output.on( 'close', () => {
				resolve();
			} );

			this.archiveBuilder.on( 'warning', ( err ) => {
				if ( err.code === 'ENOENT' ) {
					console.warn( __( 'Archiver warning:' ), err );
				} else {
					reject( err );
				}
			} );
			this.archiveBuilder.on( 'progress', ( progress ) => {
				this.emit( ExportEvents.BACKUP_CREATE_PROGRESS, {
					progress,
				} );
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

				if ( this.options.ignoreFilter?.ignores( archivePath ) ) {
					continue;
				}

				const stat = await fsPromises.stat( fullPath );
				if ( stat.isDirectory() ) {
					await this.addDirectory( fullPath, archivePath );
				} else {
					if (
						this.isExactPathExcluded( archivePath ) ||
						this.options.ignoreFilter?.ignores( archivePath )
					) {
						continue;
					}
					this.archiveBuilder.file( fullPath, { name: archivePath } );
				}
			}
		}

		this.emit( ExportEvents.WP_CONTENT_EXPORT_COMPLETE );
	}

	// `Archiver.directory()` does not follow symlinks, so we glob the directory
	// ourselves to support symlinked plugins/themes, then add each file
	// individually via `Archiver.file()`. If the source path is a symlink,
	// `Archiver.file()` appends a symlink to the archive instead of the target
	// file. We don't want this. By calling realpath first, we ensure the source
	// file data is always appended. This is preferable to passing readable
	// streams to `Archiver.append()`, which can lead to EMFILE errors.
	private async addDirectory( dirPath: string, archivePath: string ): Promise< void > {
		const relativePaths = await glob( '**/*', {
			cwd: dirPath,
			dot: true,
			follow: true,
			nodir: true,
			// Keep entry names forward-slashed on Windows
			posix: true,
		} );

		for ( const relativePath of relativePaths ) {
			const entryPathRelativeToArchiveRoot = path.join( archivePath, relativePath );
			const fullEntryPathOnDisk = path.join(
				this.options.site.path,
				entryPathRelativeToArchiveRoot
			);
			if (
				this.isExactPathExcluded( entryPathRelativeToArchiveRoot ) ||
				this.isPathExcludedByPattern( fullEntryPathOnDisk ) ||
				this.options.ignoreFilter?.ignores( entryPathRelativeToArchiveRoot )
			) {
				continue;
			}
			try {
				const resolvedPath = fs.realpathSync( fullEntryPathOnDisk );
				this.archiveBuilder.file( resolvedPath, { name: entryPathRelativeToArchiveRoot } );
			} catch ( error ) {
				// Dangling symlink. Skip it rather than aborting the whole archive.
				console.warn( `Skipping ${ entryPathRelativeToArchiveRoot }: ${ error }` );
			}
		}
	}

	private async addDatabase(): Promise< void > {
		if ( ! this.options.includes.database ) {
			return;
		}

		// The `wp sqlite export` below requires the SQLite integration to be discoverable
		// in wp-content, which imported sites don't ship. It's excluded from the archive
		// (see isExactPathExcluded), so it never reaches the backup or the remote.
		await ensureSqliteIntegrationForImportedSite( this.options.site );

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

		const [ plugins, themes ] = await Promise.all( [
			this.getSitePlugins( this.options.site ),
			this.getSiteThemes( this.options.site ),
		] );

		studioJson.plugins = this.options.ignoreFilter
			? plugins.filter(
					( p: StudioJsonPluginOrTheme ) =>
						! this.options.ignoreFilter!.ignores( `wp-content/plugins/${ p.name }` )
			  )
			: plugins;
		studioJson.themes = this.options.ignoreFilter
			? themes.filter(
					( t: StudioJsonPluginOrTheme ) =>
						! this.options.ignoreFilter!.ignores( `wp-content/themes/${ t.name }` )
			  )
			: themes;

		const tempDir = await fsPromises.mkdtemp( path.join( os.tmpdir(), 'studio-export-' ) );
		const studioJsonPath = path.join( tempDir, 'meta.json' );
		await fsPromises.writeFile( studioJsonPath, JSON.stringify( studioJson, null, 2 ) );
		return studioJsonPath;
	}

	private async getSitePlugins( site: SiteData ) {
		await using command = await runWpCliCommand(
			site,
			[
				'plugin',
				'list',
				'--status=active,inactive',
				'--fields=name,status,version',
				'--format=json',
				'--skip-plugins',
				'--skip-themes',
			],
			{ phpVersion: DEFAULT_PHP_VERSION }
		);

		const exitCode = await command.response.exitCode;
		const stderr = await command.response.stderrText;
		const stdout = await command.response.stdoutText;

		if ( exitCode !== 0 ) {
			throw new LoggerError(
				sprintf( __( 'Failed to get site plugins: %s' ), stderr ),
				undefined,
				'site_meta'
			);
		}

		try {
			return parseJsonFromPhpOutput( stdout );
		} catch ( error ) {
			if ( stderr ) {
				console.error( sprintf( __( 'Could not get information about plugins: %s' ), stderr ) );
			} else {
				console.error(
					sprintf( __( 'Could not parse plugins list. The WP CLI output: %s' ), stdout )
				);
			}

			throw new LoggerError(
				__( 'Could not parse information about installed plugins to create meta.json file.' ),
				undefined,
				'site_meta'
			);
		}
	}

	private async getSiteThemes( site: SiteData ) {
		await using command = await runWpCliCommand(
			site,
			[
				'theme',
				'list',
				'--fields=name,status,version',
				'--format=json',
				'--skip-plugins',
				'--skip-themes',
			],
			{ phpVersion: DEFAULT_PHP_VERSION }
		);

		const exitCode = await command.response.exitCode;
		const stderr = await command.response.stderrText;
		const stdout = await command.response.stdoutText;

		if ( exitCode !== 0 ) {
			throw new LoggerError(
				sprintf( __( 'Failed to get site themes: %s' ), stderr ),
				undefined,
				'site_meta'
			);
		}

		try {
			return parseJsonFromPhpOutput( stdout );
		} catch ( error ) {
			if ( stderr ) {
				console.error( sprintf( __( 'Could not get information about themes: %s' ), stderr ) );
			} else {
				console.error(
					sprintf( __( 'Could not parse themes list. The WP CLI output: %s' ), stdout )
				);
			}

			throw new LoggerError(
				__( 'Could not parse information about installed themes to create meta.json file.' ),
				undefined,
				'site_meta'
			);
		}
	}
}
