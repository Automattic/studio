import { shell } from 'electron';
import { EventEmitter } from 'events';
import fs from 'fs';
import fsPromises from 'fs/promises';
import path from 'path';
import { lstat, move, rename } from 'fs-extra';
import { isLinux } from '../../../../lib/app-globals';
import { SiteServer } from '../../../../site-server';
import { generateBackupFilename } from '../../export/generate-backup-filename';
import { ImportEvents } from '../events';
import { BackupContents } from '../types';

export interface MetaFileData {
	phpVersion: string;
	wordpressVersion: string;
}

export interface ImporterResult extends Omit< BackupContents, 'metaFile' > {
	meta?: MetaFileData;
}

export interface Importer extends Partial< EventEmitter > {
	import( rootPath: string, siteId: string ): Promise< ImporterResult >;
}

export abstract class BaseImporter extends EventEmitter implements Importer {
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
				if ( isLinux() ) {
					await move( sqlFile, tmpPath );
				} else {
					await rename( sqlFile, tmpPath );
				}
				const { stderr, exitCode } = await server.executeWpCliCommand(
					`sqlite import ${ sqlTempFile } --require=/tmp/sqlite-command/command.php`
				);

				if ( stderr ) {
					console.error( `Warning during import of ${ sqlFile }:`, stderr );
				}

				if ( exitCode ) {
					throw new Error( 'Database import failed' );
				}
			} catch ( error ) {
				console.error( `Error processing ${ sqlFile }:`, error );
				throw error;
			} finally {
				await this.safelyDeleteFile( tmpPath );
			}
		}

		this.fixSiteUrl( siteId );
		this.emit( ImportEvents.IMPORT_DATABASE_COMPLETE );
	}

	private async fixSiteUrl( siteId: string ) {
		const server = SiteServer.get( siteId );
		if ( ! server ) {
			throw new Error( 'Site not found.' );
		}

		// Step 1: Fetch the current site URL
		const { stdout: currentSiteUrl } = await server.executeWpCliCommand(
			`option get siteurl --require=/tmp/sqlite-command/command.php`
		);

		if ( ! currentSiteUrl ) {
			console.error( 'Failed to fetch site URL after import' );
			return;
		}

		const studioUrl = `http://localhost:${ server.details.port }`;
		console.log( `Current Site URL: ${ currentSiteUrl }` );
		console.log( `New Studio URL: ${ studioUrl }` );

		const { stdout, stderr, exitCode } = await server.executeWpCliCommand(
			`search-replace '${ currentSiteUrl.trim() }' '${ studioUrl.trim() }' --require=/tmp/sqlite-command/command.php`
		);

		console.log( stdout );

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

export class JetpackImporter extends BaseImporter {
	async import( rootPath: string, siteId: string ): Promise< ImporterResult > {
		this.emit( ImportEvents.IMPORT_START );

		try {
			const databaseDir = path.join( rootPath, 'wp-content', 'database' );
			const dbPath = path.join( databaseDir, '.ht.sqlite' );

			await this.moveExistingDatabaseToTrash( dbPath );
			await this.createEmptyDatabase( dbPath );
			await this.importDatabase( rootPath, siteId, this.backup.sqlFiles );
			await this.importWpContent( rootPath );
			let meta: MetaFileData | undefined;
			if ( this.backup.metaFile ) {
				meta = await this.parseMetaFile();
			}

			this.emit( ImportEvents.IMPORT_COMPLETE );
			return {
				extractionDirectory: this.backup.extractionDirectory,
				sqlFiles: this.backup.sqlFiles,
				wpContent: this.backup.wpContent,
				meta,
			};
		} catch ( error ) {
			this.emit( ImportEvents.IMPORT_ERROR, error );
			throw error;
		}
	}

	protected async createEmptyDatabase( dbPath: string ): Promise< void > {
		await fsPromises.writeFile( dbPath, '' );
	}

	protected async moveExistingDatabaseToTrash( dbPath: string ): Promise< void > {
		if ( ! fs.existsSync( dbPath ) ) {
			return;
		}
		await shell.trashItem( dbPath );
	}

	protected async importWpContent( rootPath: string ): Promise< void > {
		this.emit( ImportEvents.IMPORT_WP_CONTENT_START );
		const extractionDirectory = this.backup.extractionDirectory;
		const wpContent = this.backup.wpContent;
		const wpContentDir = path.join( rootPath, 'wp-content' );
		for ( const files of Object.values( wpContent ) ) {
			for ( const file of files ) {
				const stats = await lstat( file );
				// Skip if it's a directory
				if ( stats.isDirectory() ) {
					continue;
				}
				const relativePath = path.relative( path.join( extractionDirectory, 'wp-content' ), file );
				const destPath = path.join( wpContentDir, relativePath );
				await fsPromises.mkdir( path.dirname( destPath ), { recursive: true } );
				await fsPromises.copyFile( file, destPath );
			}
		}
		this.emit( ImportEvents.IMPORT_WP_CONTENT_COMPLETE );
	}

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

export class SQLImporter extends BaseImporter {
	async import( rootPath: string, siteId: string ): Promise< ImporterResult > {
		this.emit( ImportEvents.IMPORT_START );

		try {
			await this.importDatabase( rootPath, siteId, this.backup.sqlFiles );

			this.emit( ImportEvents.IMPORT_COMPLETE );
			return {
				extractionDirectory: this.backup.extractionDirectory,
				sqlFiles: this.backup.sqlFiles,
				wpContent: this.backup.wpContent,
			};
		} catch ( error ) {
			this.emit( ImportEvents.IMPORT_ERROR, error );
			throw error;
		}
	}
}
