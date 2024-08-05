import { EventEmitter } from 'events';
import fsPromises from 'fs/promises';
import path from 'path';
import { lstat, rename } from 'fs-extra';
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

export class DefaultImporter extends EventEmitter implements Importer {
	constructor( protected backup: BackupContents ) {
		super();
	}

	async import( rootPath: string, siteId: string ): Promise< ImporterResult > {
		this.emit( ImportEvents.IMPORT_START );

		try {
			await this.importDatabase( rootPath, siteId );
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

	protected async hasCreateWithoutDrop( sqlFiles: string[] ): Promise< boolean > {
		const wpUsersSql = sqlFiles.find( ( file ) => file.endsWith( 'wp_users.sql' ) );
		if ( ! wpUsersSql ) {
			return false;
		}

		try {
			const content = await fsPromises.readFile( wpUsersSql, 'utf-8' );
			return content.includes( 'CREATE TABLE' ) && ! content.includes( 'DROP TABLE' );
		} catch ( error ) {
			console.error( 'Error reading wp_users.sql:', error );
			return false;
		}
	}

	protected async backupAndCreateNewDatabase( rootPath: string ): Promise< void > {
		const databaseDir = path.join( rootPath, 'wp-content', 'database' );
		const existingDbPath = path.join( databaseDir, '.ht.sqlite' );
		const backupDbPath = path.join( databaseDir, `.${ Date.now() }-backup.ht.sqlite` );

		try {
			await fsPromises.mkdir( databaseDir, { recursive: true } );
			await fsPromises.rename( existingDbPath, backupDbPath );
			await fsPromises.writeFile( existingDbPath, '' );
		} catch ( error ) {
			console.error( 'Error handling database:', error );
			throw new Error( 'Failed to backup or create new database' );
		}
	}

	protected async importDatabase( rootPath: string, siteId: string ): Promise< void > {
		if ( ! this.backup.sqlFiles.length ) {
			return;
		}

		const server = SiteServer.get( siteId );
		if ( ! server ) {
			throw new Error( 'Site not found.' );
		}

		this.emit( ImportEvents.IMPORT_DATABASE_START );
		const sortedSqlFiles = [ ...this.backup.sqlFiles ].sort( ( a, b ) => a.localeCompare( b ) );

		if ( await this.hasCreateWithoutDrop( sortedSqlFiles ) ) {
			await this.backupAndCreateNewDatabase( rootPath );
		}

		await this.importSqlFiles( rootPath, server, sortedSqlFiles );

		this.emit( ImportEvents.IMPORT_DATABASE_COMPLETE );
	}

	protected async importSqlFiles(
		rootPath: string,
		server: SiteServer,
		sqlFiles: string[]
	): Promise< void > {
		for ( const sqlFile of sqlFiles ) {
			const sqlTempFile = `${ generateBackupFilename( 'sql' ) }.sql`;
			const tmpPath = path.join( rootPath, sqlTempFile );

			try {
				await rename( sqlFile, tmpPath );
				const { stderr, exitCode } = await server.executeWpCliCommand(
					`db import ${ sqlTempFile }`
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
	}

	protected async safelyDeleteFile( filePath: string ): Promise< void > {
		try {
			await fsPromises.unlink( filePath );
		} catch ( error ) {
			console.error( `Failed to delete temporary file ${ filePath }:`, error );
		}
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
