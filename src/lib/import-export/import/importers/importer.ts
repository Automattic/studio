import { EventEmitter } from 'events';
import fsPromises from 'fs/promises';
import path from 'path';
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
	import( rootPath: string ): Promise< ImporterResult >;
}

export class DefaultImporter extends EventEmitter implements Importer {
	constructor( protected backup: BackupContents ) {
		super();
	}

	async import( rootPath: string ): Promise< ImporterResult > {
		this.emit( ImportEvents.IMPORT_START );

		await this.importDatabase();
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
	}

	protected async importDatabase(): Promise< void > {
		this.emit( ImportEvents.IMPORT_DATABASE_START );
		// will implement in a different ticket
		this.emit( ImportEvents.IMPORT_DATABASE_COMPLETE );
	}

	protected async importWpContent( rootPath: string ): Promise< void > {
		this.emit( ImportEvents.IMPORT_WP_CONTENT_START );
		const extractionDirectory = this.backup.extractionDirectory;
		const wpContent = this.backup.wpContent;
		const wpContentDir = path.join( rootPath, 'wp-content' );
		for ( const files of Object.values( wpContent ) ) {
			for ( const file of files ) {
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
			const meta = JSON.parse( metaContent );
			return meta;
		} catch ( e ) {
			return;
		} finally {
			this.emit( ImportEvents.IMPORT_META_COMPLETE );
		}
	}
}
