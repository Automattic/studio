import fs from 'fs';
import path from 'path';
import { createInterface } from 'readline';
import { DEFAULT_PHP_VERSION } from '@studio/common/constants';
import { generateBackupFilename } from '@studio/common/lib/generate-backup-filename';
import { ImportEvents } from '@studio/common/lib/import-export-events';
import { isErrnoException } from '@studio/common/lib/is-errno-exception';
import { serializePlugins } from '@studio/common/lib/serialize-plugins';
import {
	RecommendedPHPVersion,
	SupportedPHPVersions,
	type SupportedPHPVersion,
} from '@studio/common/types/php-versions';
import { __, sprintf } from '@wordpress/i18n';
import { move } from 'fs-extra';
import semver from 'semver';
import trash from 'trash';
import { SiteData } from 'cli/lib/cli-config/core';
import { runWpCliCommand } from 'cli/lib/run-wp-cli-command';
import { ensureSqliteIntegrationForImportedSite } from 'cli/lib/sqlite-integration';
import { ImportExportEventEmitter } from '../../events';
import { BackupContents, MetaFileData } from '../types';
import { updateSiteUrl } from '../update-site-url';

export interface ImporterResult extends Omit< BackupContents, 'metaFile' > {
	meta?: MetaFileData;
}

export interface Importer extends ImportExportEventEmitter {
	import( site: SiteData ): Promise< ImporterResult >;
}

// Recovers from EEXIST/ENOTDIR by removing a non-directory blocker on the path.
export async function ensureDir( dir: string ): Promise< void > {
	try {
		await fs.promises.mkdir( dir, { recursive: true } );
	} catch ( error ) {
		if ( ! isErrnoException( error ) || ( error.code !== 'EEXIST' && error.code !== 'ENOTDIR' ) ) {
			throw error;
		}
		const parent = path.dirname( dir );
		if ( parent === dir ) {
			throw error;
		}
		await ensureDir( parent );
		try {
			const stat = await fs.promises.stat( dir );
			if ( ! stat.isDirectory() ) {
				await trash( dir );
				console.warn( `ensureDir: moved non-directory blocker at ${ dir } to trash` );
			}
		} catch ( e ) {
			if ( ! isErrnoException( e ) || e.code !== 'ENOENT' ) {
				throw e;
			}
		}
		await fs.promises.mkdir( dir, { recursive: true } );
	}
}

abstract class BaseImporter extends ImportExportEventEmitter implements Importer {
	protected meta?: MetaFileData;

	constructor( protected backup: BackupContents ) {
		super();
	}

	abstract import( site: SiteData ): Promise< ImporterResult >;

	protected async importDatabase( site: SiteData, sqlFiles: string[] ): Promise< void > {
		if ( ! sqlFiles.length ) {
			return;
		}

		// The `wp sqlite import` below runs without the reprint runtime.php that wires
		// SQLite for imported sites, so the integration has to be discoverable in
		// wp-content instead. Mirrors the export side; no-op for regular sites.
		await ensureSqliteIntegrationForImportedSite( site );

		this.emit( ImportEvents.IMPORT_DATABASE_START );

		const sortedSqlFiles = sqlFiles.sort( ( a, b ) => a.localeCompare( b ) );
		let processedFiles = 0;
		const totalFiles = sortedSqlFiles.length;

		for ( const sqlFile of sortedSqlFiles ) {
			const sqlTempFile = `${ generateBackupFilename( 'sql' ) }.sql`;
			const tmpPath = path.join( site.path, sqlTempFile );
			processedFiles++;

			this.emit( ImportEvents.IMPORT_DATABASE_PROGRESS, {
				currentFile: path.basename( sqlFile ),
				processedFiles,
				totalFiles,
			} );

			try {
				await move( sqlFile, tmpPath );
				await this.prepareSqlFile( tmpPath );

				await using command = await runWpCliCommand(
					site,
					[
						'sqlite',
						'import',
						sqlTempFile,
						'--enable-ast-driver',
						'--skip-plugins',
						'--skip-themes',
					],
					{
						requireSqliteCliCommand: true,
						phpVersion: DEFAULT_PHP_VERSION,
					}
				);

				const exitCode = await command.response.exitCode;
				const stderr = await command.response.stderrText;

				if ( stderr ) {
					console.error( sprintf( __( 'Error during import of %s:' ), sqlFile ), stderr );
				}

				if ( exitCode !== 0 ) {
					throw new Error( sprintf( __( 'Database import failed: %s' ), stderr ) );
				}
			} finally {
				await this.safelyDeletePath( tmpPath );
			}
		}

		await updateSiteUrl( site );
		this.emit( ImportEvents.IMPORT_DATABASE_COMPLETE );
	}

	protected async prepareSqlFile( _tmpPath: string ): Promise< void > {
		// This method can be overridden by subclasses to prepare the SQL file before import.
	}

	protected async safelyDeletePath( path: string ): Promise< void > {
		try {
			await fs.promises.rm( path, { recursive: true, force: true } );
		} catch ( error ) {
			console.error( `Failed to safely delete path ${ path }:`, error );
		}
	}
}

abstract class BaseBackupImporter extends BaseImporter {
	protected shouldCleanUpBeforeImport: boolean = true;

	async import( site: SiteData ): Promise< ImporterResult > {
		try {
			if ( this.shouldCleanUpBeforeImport ) {
				await this.moveExistingWpContentToTrash( site.path );
			}
			await this.importWpConfig( site.path );
			await this.importWpContent( site.path );
			if ( this.backup.metaFile ) {
				this.meta = await this.parseMetaFile();
			}
			if ( this.backup.sqlFiles.length ) {
				const databaseDir = path.join( site.path, 'wp-content', 'database' );
				const dbPath = path.join( databaseDir, '.ht.sqlite' );

				await this.moveExistingDatabaseToTrash( dbPath );
				await this.createEmptyDatabase( dbPath );
				await this.importDatabase( site, this.backup.sqlFiles );
			}

			return {
				extractionDirectory: this.backup.extractionDirectory,
				sqlFiles: this.backup.sqlFiles,
				wpContentFiles: this.backup.wpContentFiles,
				wpContentDirectory: this.backup.wpContentDirectory,
				wpConfig: this.backup.wpConfig,
				meta: this.meta,
			};
		} catch ( error ) {
			this.emit(
				ImportEvents.IMPORT_ERROR,
				error instanceof Error ? error.message : String( error )
			);
			throw error;
		}
	}

	protected abstract parseMetaFile(): Promise< MetaFileData | undefined >;

	protected async createEmptyDatabase( dbPath: string ): Promise< void > {
		await fs.promises.writeFile( dbPath, '' );
	}

	protected async moveExistingDatabaseToTrash( dbPath: string ): Promise< void > {
		if ( ! fs.existsSync( dbPath ) ) {
			return;
		}
		await trash( dbPath );
	}

	protected async moveExistingWpContentToTrash( rootPath: string ): Promise< void > {
		const wpContentDir = path.join( rootPath, 'wp-content' );
		try {
			if ( ! fs.existsSync( wpContentDir ) ) {
				return;
			}
			const contentToKeep = [
				/^mu-plugins$/, // Match mu-plugins directory exactly
				/^mu-plugins(\/|\\)sqlite-database-integration(\/|\\)?.*/, // Match sqlite-database-integration dir and contents
				/^database(\/|\\)?.*/, // Match database dir and all contents
				/^db\.php$/, // Exact match for db.php
				/^index\.php$/, // Exact match for index.php
				/^languages(\/|\\)?.*/, // Match languages dir and all contents
			];

			const contents = await fs.promises.readdir( wpContentDir, { recursive: true } );

			for ( const content of contents ) {
				if ( contentToKeep.some( ( pattern ) => pattern.test( content ) ) ) {
					continue;
				}
				await this.safelyDeletePath( path.join( wpContentDir, content ) );
			}
		} catch {
			return;
		}
	}

	protected async importWpConfig( rootPath: string ): Promise< void > {
		const wpConfigPath = path.join( rootPath, 'wp-config.php' );
		const wpConfigSamplePath = path.join( rootPath, 'wp-config-sample.php' );

		if ( this.backup.wpConfig ) {
			await fs.promises.copyFile( this.backup.wpConfig, wpConfigPath );
		} else if ( ! fs.existsSync( wpConfigPath ) && fs.existsSync( wpConfigSamplePath ) ) {
			await fs.promises.copyFile( wpConfigSamplePath, wpConfigPath );
		}
	}

	protected async importWpContent( rootPath: string ): Promise< void > {
		this.emit( ImportEvents.IMPORT_WP_CONTENT_START );
		const extractionDirectory = this.backup.extractionDirectory;
		const wpContentSourceDir = this.backup.wpContentDirectory;
		const wpContentDestDir = path.join( rootPath, 'wp-content' );

		// Group files by type
		const filesByType = this.categorizeWpContentFiles( this.backup.wpContentFiles );
		let processedItems = 0;
		const totalItems = this.backup.wpContentFiles.length;

		for ( const [ type, files ] of Object.entries( filesByType ) ) {
			for ( const file of files ) {
				try {
					const stats = await fs.promises.lstat( file );
					// Skip if it's a directory
					if ( stats.isDirectory() ) {
						continue;
					}
				} catch {
					/**
					 * If the file does not exist, skip it.
					 * This can happen if a empty directory is included in the backup
					 * because the empty directory won't be included in the extraction.
					 */
					continue;
				}

				const relativePath = path.relative(
					path.join( extractionDirectory, wpContentSourceDir ),
					file
				);

				const destPath = path.join( wpContentDestDir, relativePath );
				await ensureDir( path.dirname( destPath ) );
				await fs.promises.copyFile( file, destPath );

				processedItems++;

				// Emit progress event after file is copied
				this.emit( ImportEvents.IMPORT_WP_CONTENT_PROGRESS, {
					type: type as 'plugins' | 'themes' | 'uploads' | 'other',
					currentItem: relativePath,
					processedItems,
					totalItems,
				} );
			}
		}
		this.emit( ImportEvents.IMPORT_WP_CONTENT_COMPLETE );
	}

	protected categorizeWpContentFiles( files: string[] ): Record< string, string[] > {
		const categorized: Record< string, string[] > = {
			plugins: [],
			themes: [],
			uploads: [],
			other: [],
		};

		for ( const file of files ) {
			const segments = file.split( /[/\\]/ );

			if ( segments.includes( 'plugins' ) ) {
				categorized.plugins.push( file );
			} else if ( segments.includes( 'themes' ) ) {
				categorized.themes.push( file );
			} else if ( segments.includes( 'uploads' ) ) {
				categorized.uploads.push( file );
			} else {
				categorized.other.push( file );
			}
		}

		return categorized;
	}

	protected parsePhpVersion( version: string | undefined ): string {
		if ( ! version ) {
			return RecommendedPHPVersion;
		}
		const phpVersion = semver.coerce( version );
		if ( ! phpVersion ) {
			return RecommendedPHPVersion;
		}

		const parsedVersion = `${ phpVersion.major }.${ phpVersion.minor }`;

		return SupportedPHPVersions.includes( parsedVersion as SupportedPHPVersion )
			? parsedVersion
			: RecommendedPHPVersion;
	}
}

export class JetpackImporter extends BaseBackupImporter {
	// Jetpack importer follows merge strategy to support selective sync
	protected shouldCleanUpBeforeImport = false;

	protected async parseMetaFile(): Promise< MetaFileData | undefined > {
		const metaFilePath = this.backup.metaFile;
		if ( ! metaFilePath ) {
			return;
		}
		this.emit( ImportEvents.IMPORT_META_START );
		try {
			const metaContent = await fs.promises.readFile( metaFilePath, 'utf-8' );
			const meta = JSON.parse( metaContent );
			return {
				phpVersion: this.parsePhpVersion( meta?.phpVersion ),
				wordpressVersion: meta?.wordpressVersion || '',
			};
		} catch ( e ) {
			return;
		} finally {
			this.emit( ImportEvents.IMPORT_META_COMPLETE );
		}
	}

	async import( site: SiteData ): Promise< ImporterResult > {
		this.emit( ImportEvents.IMPORT_START, 'jetpack' );
		const result = await super.import( site );
		this.emit( ImportEvents.IMPORT_COMPLETE, 'jetpack' );
		return result;
	}
}

export class LocalImporter extends BaseBackupImporter {
	protected async parseMetaFile(): Promise< MetaFileData | undefined > {
		const metaFilePath = this.backup.metaFile;
		if ( ! metaFilePath ) {
			return;
		}
		this.emit( ImportEvents.IMPORT_META_START );
		try {
			const metaContent = await fs.promises.readFile( metaFilePath, 'utf-8' );
			const meta = JSON.parse( metaContent );
			return {
				phpVersion: this.parsePhpVersion( meta?.services?.php?.version ),
				wordpressVersion: '',
			};
		} catch ( e ) {
			return;
		} finally {
			this.emit( ImportEvents.IMPORT_META_COMPLETE );
		}
	}

	async import( site: SiteData ): Promise< ImporterResult > {
		this.emit( ImportEvents.IMPORT_START, 'local' );
		const result = await super.import( site );
		this.emit( ImportEvents.IMPORT_COMPLETE, 'local' );
		return result;
	}
}

export class PlaygroundImporter extends BaseBackupImporter {
	protected async importDatabase( site: SiteData, sqlFiles: string[] ): Promise< void > {
		if ( ! sqlFiles.length ) {
			return;
		}

		this.emit( ImportEvents.IMPORT_DATABASE_START );

		for ( const sqlFile of sqlFiles ) {
			await move( sqlFile, path.join( site.path, 'wp-content', 'database', '.ht.sqlite' ), {
				overwrite: true,
			} );
		}
		await updateSiteUrl( site );

		this.emit( ImportEvents.IMPORT_DATABASE_COMPLETE );
	}

	protected async parseMetaFile(): Promise< MetaFileData | undefined > {
		return undefined;
	}

	async import( site: SiteData ): Promise< ImporterResult > {
		this.emit( ImportEvents.IMPORT_START, 'playground' );
		const result = await super.import( site );
		this.emit( ImportEvents.IMPORT_COMPLETE, 'playground' );
		return result;
	}
}

export class SQLImporter extends BaseImporter {
	async import( site: SiteData ): Promise< ImporterResult > {
		this.emit( ImportEvents.IMPORT_START, 'sql' );

		try {
			await this.importDatabase( site, this.backup.sqlFiles );

			this.emit( ImportEvents.IMPORT_COMPLETE, 'sql' );
			return {
				extractionDirectory: this.backup.extractionDirectory,
				sqlFiles: this.backup.sqlFiles,
				wpConfig: this.backup.wpConfig,
				wpContentFiles: this.backup.wpContentFiles,
				wpContentDirectory: this.backup.wpContentDirectory,
			};
		} catch ( error ) {
			this.emit(
				ImportEvents.IMPORT_ERROR,
				error instanceof Error ? error.message : String( error )
			);
			throw error;
		}
	}
}

export class WpressImporter extends BaseBackupImporter {
	protected async parseMetaFile(): Promise< MetaFileData > {
		const packageJsonPath = path.join( this.backup.extractionDirectory, 'package.json' );
		try {
			const packageContent = await fs.promises.readFile( packageJsonPath, 'utf8' );
			const {
				Template: template = '',
				Stylesheet: stylesheet = '',
				Plugins: plugins = [],
			} = JSON.parse( packageContent );
			return { template, stylesheet, plugins };
		} catch ( error ) {
			console.error( 'Error reading package.json:', error );
			return { template: '', stylesheet: '', plugins: [] };
		}
	}

	protected async prepareSqlFile( tmpPath: string ): Promise< void > {
		const tempOutputPath = `${ tmpPath }.tmp`;
		const readStream = fs.createReadStream( tmpPath, 'utf8' );
		const writeStream = fs.createWriteStream( tempOutputPath, 'utf8' );

		const rl = createInterface( {
			input: readStream,
			crlfDelay: Infinity,
		} );

		rl.on( 'line', ( line: string ) => {
			writeStream.write( line.replace( /SERVMASK_PREFIX/g, 'wp' ) + '\n' );
		} );

		await new Promise( ( resolve, reject ) => {
			rl.on( 'close', resolve );
			rl.on( 'error', reject );
		} );

		await new Promise( ( resolve, reject ) => {
			writeStream.end( resolve );
			writeStream.on( 'error', reject );
		} );

		await fs.promises.rename( tempOutputPath, tmpPath );
	}

	protected async addSqlToSetTheme( sqlFiles: string[] ): Promise< void > {
		const { template, stylesheet } = this.meta || {};
		if ( ! template || ! stylesheet ) {
			return;
		}

		const themeUpdateSql = `
				UPDATE wp_options SET option_value = '${ template }' WHERE option_name = 'template';
				UPDATE wp_options SET option_value = '${ stylesheet }' WHERE option_name = 'stylesheet';
			`;
		const sqliteSetThemePath = path.join(
			this.backup.extractionDirectory,
			'studio-wpress-theme.sql'
		);
		await fs.promises.writeFile( sqliteSetThemePath, themeUpdateSql );
		sqlFiles.push( sqliteSetThemePath );
	}

	protected async addSqlToActivatePlugins( sqlFiles: string[] ): Promise< void > {
		const { plugins = [] } = this.meta || {};
		if ( plugins.length === 0 ) {
			return;
		}

		const serializedPlugins = serializePlugins( plugins );
		const activatePluginsSql = `
			INSERT INTO wp_options (option_name, option_value, autoload) VALUES ('active_plugins', '${ serializedPlugins }', 'yes')
			ON DUPLICATE KEY UPDATE option_value = VALUES(option_value), autoload = VALUES(autoload);
		`;

		const sqliteActivatePluginsPath = path.join(
			this.backup.extractionDirectory,
			'studio-wpress-activate-plugins.sql'
		);
		await fs.promises.writeFile( sqliteActivatePluginsPath, activatePluginsSql );
		sqlFiles.push( sqliteActivatePluginsPath );
	}

	protected async importDatabase( site: SiteData, sqlFiles: string[] ): Promise< void > {
		await this.addSqlToSetTheme( sqlFiles );
		await this.addSqlToActivatePlugins( sqlFiles );
		await super.importDatabase( site, sqlFiles );
	}

	async import( site: SiteData ): Promise< ImporterResult > {
		this.emit( ImportEvents.IMPORT_START, 'wpress' );
		const result = await super.import( site );
		this.emit( ImportEvents.IMPORT_COMPLETE, 'wpress' );
		return result;
	}
}
