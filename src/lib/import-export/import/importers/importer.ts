import { shell } from 'electron';
import { EventEmitter } from 'events';
import fs, { createReadStream, createWriteStream } from 'fs';
import fsPromises from 'fs/promises';
import path from 'path';
import { createInterface } from 'readline';
import { lstat, move } from 'fs-extra';
import semver from 'semver';
import { DEFAULT_PHP_VERSION } from '../../../../../vendor/wp-now/src/constants';
import { SiteServer } from '../../../../site-server';
import { serializePlugins } from '../../../serialize-plugins';
import { generateBackupFilename } from '../../export/generate-backup-filename';
import { ImportEvents } from '../events';
import { BackupContents, MetaFileData } from '../types';

export interface ImporterResult extends Omit< BackupContents, 'metaFile' > {
	meta?: MetaFileData;
}

export interface Importer extends Partial< EventEmitter > {
	import( rootPath: string, siteId: string ): Promise< ImporterResult >;
}

abstract class BaseImporter extends EventEmitter implements Importer {
	protected meta?: MetaFileData;

	constructor( protected backup: BackupContents ) {
		super();
	}

	abstract import( rootPath: string, siteId: string ): Promise< ImporterResult >;

	protected async importDatabase(
		rootPath: string,
		siteId: string,
		sqlFiles: string[]
	): Promise< void > {
		if ( ! sqlFiles.length ) {
			return;
		}

		const server = SiteServer.get( siteId );
		if ( ! server ) {
			throw new Error( 'Site not found.' );
		}

		this.emit( ImportEvents.IMPORT_DATABASE_START );

		const sortedSqlFiles = sqlFiles.sort( ( a, b ) => a.localeCompare( b ) );
		for ( const sqlFile of sortedSqlFiles ) {
			const sqlTempFile = `${ generateBackupFilename( 'sql' ) }.sql`;
			const tmpPath = path.join( rootPath, sqlTempFile );

			try {
				await move( sqlFile, tmpPath );
				await this.prepareSqlFile( tmpPath );
				const { stderr, exitCode } = await server.executeWpCliCommand(
					`sqlite import ${ sqlTempFile } --require=/tmp/sqlite-command/command.php`,
					// SQLite plugin requires PHP 8+
					{ targetPhpVersion: DEFAULT_PHP_VERSION }
				);

				if ( stderr ) {
					console.error( `Warning during import of ${ sqlFile }:`, stderr );
				}

				if ( exitCode ) {
					throw new Error( 'Database import failed' );
				}
			} finally {
				await this.safelyDeleteFile( tmpPath );
			}
		}

		await this.replaceSiteUrl( siteId );
		this.emit( ImportEvents.IMPORT_DATABASE_COMPLETE );
	}

	protected async prepareSqlFile( _tmpPath: string ): Promise< void > {
		// This method can be overridden by subclasses to prepare the SQL file before import.
	}

	protected async replaceSiteUrl( siteId: string ) {
		const server = SiteServer.get( siteId );
		if ( ! server ) {
			throw new Error( 'Site not found.' );
		}

		const { stdout: currentSiteUrl } = await server.executeWpCliCommand( `option get siteurl` );

		if ( ! currentSiteUrl ) {
			console.error( 'Failed to fetch site URL after import' );
			return;
		}

		const studioUrl = `http://localhost:${ server.details.port }`;

		const { stderr, exitCode } = await server.executeWpCliCommand(
			`search-replace '${ currentSiteUrl.trim() }' '${ studioUrl.trim() }'`
		);

		if ( stderr ) {
			console.error(
				`Warning during replacing siteUrl ${ currentSiteUrl } -> ${ studioUrl }: ${ stderr }`
			);
		}

		if ( exitCode ) {
			console.error(
				`Error during replacing siteUrl ${ currentSiteUrl } -> ${ studioUrl }, Exit Code: ${ exitCode }`
			);
		}
	}

	protected async safelyDeleteFile( filePath: string ): Promise< void > {
		try {
			await fsPromises.unlink( filePath );
		} catch ( error ) {
			console.error( `Failed to safely delete file ${ filePath }:`, error );
		}
	}
}

abstract class BaseBackupImporter extends BaseImporter {
	async import( rootPath: string, siteId: string ): Promise< ImporterResult > {
		this.emit( ImportEvents.IMPORT_START );

		try {
			const databaseDir = path.join( rootPath, 'wp-content', 'database' );
			const dbPath = path.join( databaseDir, '.ht.sqlite' );
			await this.moveExistingDatabaseToTrash( dbPath );
			await this.moveExistingWpContentToTrash( rootPath );
			await this.createEmptyDatabase( dbPath );
			await this.importWpConfig( rootPath );
			await this.importWpContent( rootPath );
			if ( this.backup.metaFile ) {
				this.meta = await this.parseMetaFile();
			}
			await this.importDatabase( rootPath, siteId, this.backup.sqlFiles );

			this.emit( ImportEvents.IMPORT_COMPLETE );
			return {
				extractionDirectory: this.backup.extractionDirectory,
				sqlFiles: this.backup.sqlFiles,
				wpContent: this.backup.wpContent,
				wpContentDirectory: this.backup.wpContentDirectory,
				wpConfig: this.backup.wpConfig,
				meta: this.meta,
			};
		} catch ( error ) {
			this.emit( ImportEvents.IMPORT_ERROR, error );
			throw error;
		}
	}

	protected abstract parseMetaFile(): Promise< MetaFileData | undefined >;

	protected async createEmptyDatabase( dbPath: string ): Promise< void > {
		await fsPromises.writeFile( dbPath, '' );
	}

	protected async moveExistingDatabaseToTrash( dbPath: string ): Promise< void > {
		if ( ! fs.existsSync( dbPath ) ) {
			return;
		}
		await shell.trashItem( dbPath );
	}

	protected async moveExistingWpContentToTrash( rootPath: string ): Promise< void > {
		const wpContentDir = path.join( rootPath, 'wp-content' );
		try {
			if ( ! fs.existsSync( wpContentDir ) ) {
				return;
			}
			const contentToKeep = [ 'mu-plugins', 'database', 'db.php' ];

			const contents = await fsPromises.readdir( wpContentDir );

			for ( const content of contents ) {
				const contentPath = path.join( wpContentDir, content );

				if ( contentToKeep.includes( content ) ) {
					continue;
				}
				await this.safelyDeleteFile( contentPath );
			}
		} catch {
			return;
		}
	}

	protected async importWpConfig( rootPath: string ): Promise< void > {
		if ( ! this.backup.wpConfig ) {
			return;
		}
		await fsPromises.copyFile( this.backup.wpConfig, `${ rootPath }/wp-config.php` );
	}

	protected async importWpContent( rootPath: string ): Promise< void > {
		this.emit( ImportEvents.IMPORT_WP_CONTENT_START );
		const extractionDirectory = this.backup.extractionDirectory;
		const wpContent = this.backup.wpContent;
		const wpContentSourceDir = this.backup.wpContentDirectory;
		const wpContentDestDir = path.join( rootPath, 'wp-content' );
		for ( const files of Object.values( wpContent ) ) {
			for ( const file of files ) {
				const stats = await lstat( file );
				// Skip if it's a directory
				if ( stats.isDirectory() ) {
					continue;
				}
				const relativePath = path.relative(
					path.join( extractionDirectory, wpContentSourceDir ),
					file
				);
				const destPath = path.join( wpContentDestDir, relativePath );
				await fsPromises.mkdir( path.dirname( destPath ), { recursive: true } );
				await fsPromises.copyFile( file, destPath );
			}
		}
		this.emit( ImportEvents.IMPORT_WP_CONTENT_COMPLETE );
	}
}

export class JetpackImporter extends BaseBackupImporter {
	protected async parseMetaFile(): Promise< MetaFileData | undefined > {
		const metaFilePath = this.backup.metaFile;
		if ( ! metaFilePath ) {
			return;
		}
		this.emit( ImportEvents.IMPORT_META_START );
		try {
			const metaContent = await fsPromises.readFile( metaFilePath, 'utf-8' );
			return JSON.parse( metaContent );
		} catch ( e ) {
			return;
		} finally {
			this.emit( ImportEvents.IMPORT_META_COMPLETE );
		}
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
			const metaContent = await fsPromises.readFile( metaFilePath, 'utf-8' );
			const meta = JSON.parse( metaContent );
			const phpVersion = semver.coerce( meta?.services?.php?.version );
			return {
				phpVersion: phpVersion
					? `${ phpVersion.major }.${ phpVersion.minor }`
					: DEFAULT_PHP_VERSION,
				wordpressVersion: '',
			};
		} catch ( e ) {
			return;
		} finally {
			this.emit( ImportEvents.IMPORT_META_COMPLETE );
		}
	}
}

export class PlaygroundImporter extends BaseBackupImporter {
	protected async importDatabase(
		rootPath: string,
		siteId: string,
		sqlFiles: string[]
	): Promise< void > {
		if ( ! sqlFiles.length ) {
			return;
		}
		const server = SiteServer.get( siteId );
		if ( ! server ) {
			throw new Error( 'Site not found.' );
		}

		this.emit( ImportEvents.IMPORT_DATABASE_START );

		for ( const sqlFile of sqlFiles ) {
			await move( sqlFile, path.join( rootPath, 'wp-content', 'database', '.ht.sqlite' ), {
				overwrite: true,
			} );
		}
		await this.replaceSiteUrl( siteId );

		this.emit( ImportEvents.IMPORT_DATABASE_COMPLETE );
	}

	protected async parseMetaFile(): Promise< MetaFileData | undefined > {
		return undefined;
	}
}

export class SQLImporter extends BaseImporter {
	async import( rootPath: string, siteId: string ): Promise< ImporterResult > {
		this.emit( ImportEvents.IMPORT_START );

		try {
			await this.importDatabase( rootPath, siteId, this.backup.sqlFiles );

			this.emit( ImportEvents.IMPORT_COMPLETE );
			return {
				extractionDirectory: this.backup.extractionDirectory,
				sqlFiles: this.backup.sqlFiles,
				wpConfig: this.backup.wpConfig,
				wpContent: this.backup.wpContent,
				wpContentDirectory: this.backup.wpContentDirectory,
			};
		} catch ( error ) {
			this.emit( ImportEvents.IMPORT_ERROR, error );
			throw error;
		}
	}
}

export class WpressImporter extends BaseBackupImporter {
	protected async parseMetaFile(): Promise< MetaFileData > {
		const packageJsonPath = path.join( this.backup.extractionDirectory, 'package.json' );
		try {
			const packageContent = await fsPromises.readFile( packageJsonPath, 'utf8' );
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
		const readStream = createReadStream( tmpPath, 'utf8' );
		const writeStream = createWriteStream( tempOutputPath, 'utf8' );

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

		await fsPromises.rename( tempOutputPath, tmpPath );
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
		await fsPromises.writeFile( sqliteSetThemePath, themeUpdateSql );
		sqlFiles.push( sqliteSetThemePath );
	}

	protected async addSqlToActivatePlugins( sqlFiles: string[] ): Promise< void > {
		const { plugins = [] } = this.meta || {};
		if ( plugins.length === 0 ) {
			return;
		}

		const serializedPlugins = serializePlugins( plugins );
		const activatePluginsSql = `
			INSERT INTO wp_options (option_name, option_value, autoload) VALUES ('active_plugins', '${ serializedPlugins }', 'yes');
		`;

		const sqliteActivatePluginsPath = path.join(
			this.backup.extractionDirectory,
			'studio-wpress-activate-plugins.sql'
		);
		await fsPromises.writeFile( sqliteActivatePluginsPath, activatePluginsSql );
		sqlFiles.push( sqliteActivatePluginsPath );
	}

	protected async importDatabase(
		rootPath: string,
		siteId: string,
		sqlFiles: string[]
	): Promise< void > {
		const server = SiteServer.get( siteId );
		if ( ! server ) {
			throw new Error( 'Site not found.' );
		}
		await this.addSqlToSetTheme( sqlFiles );
		await this.addSqlToActivatePlugins( sqlFiles );
		await super.importDatabase( rootPath, siteId, sqlFiles );
	}
}
