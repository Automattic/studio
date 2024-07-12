import fsPromises from 'fs/promises';
import path from 'path';
import { BackupContents } from '../types';
import { Importer, ImporterResult, MetaFileData } from './Importer';

export class JetpackImporter implements Importer {
	constructor( private backup: BackupContents ) {}

	async import( rootPath: string ): Promise< ImporterResult > {
		await this.importDatabase();
		await this.importWpContent( rootPath );
		let meta: MetaFileData | undefined;
		if ( this.backup.metaFile ) {
			meta = await this.handleMetaFile();
		}

		return {
			extractionDirectory: this.backup.extractionDirectory,
			sqlFiles: this.backup.sqlFiles,
			wpContent: this.backup.wpContent,
			meta,
		};
	}

	public getBackupContents(): BackupContents {
		return this.backup;
	}

	private async importDatabase(): Promise< void > {
		//empty
	}

	private async importWpContent( rootPath: string ): Promise< void > {
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

	private async handleMetaFile(): Promise< MetaFileData | undefined > {
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
