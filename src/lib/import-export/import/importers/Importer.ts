import fsPromises from 'fs/promises';
import path from 'path';
import { BackupContents } from '../types';

export interface MetaFileData {
	phpVersion: string;
	wordpressVersion: string;
}

export interface ImporterResult extends Omit< BackupContents, 'metaFile' > {
	meta?: MetaFileData;
}

export interface Importer {
	import( rootPath: string ): Promise< ImporterResult >;
}

export class DefaultImporter implements Importer {
	constructor( protected backup: BackupContents ) {}

	async import( rootPath: string ): Promise< ImporterResult > {
		await this.importDatabase();
		await this.importWpContent( rootPath );
		let meta: MetaFileData | undefined;
		if ( this.backup.metaFile ) {
			meta = await this.parseMetaFile();
		}
		return {
			extractionDirectory: this.backup.extractionDirectory,
			sqlFiles: this.backup.sqlFiles,
			wpContent: this.backup.wpContent,
			meta,
		};
	}

	protected async importDatabase(): Promise< void > {
		// empty in DefaultImporter
	}

	protected async importWpContent( rootPath: string ): Promise< void > {
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
	}

	protected async parseMetaFile(): Promise< MetaFileData | undefined > {
		const metaFilePath = this.backup.metaFile;
		if ( ! metaFilePath ) {
			return;
		}
		try {
			const metaContent = await fsPromises.readFile( metaFilePath, 'utf-8' );
			const meta = JSON.parse( metaContent );
			return meta;
		} catch ( e ) {
			return;
		}
	}
}
