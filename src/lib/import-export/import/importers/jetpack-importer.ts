import fsPromises from 'fs/promises';
import path from 'path';
import { BackupContents } from '../types';
import { Importer } from './Importer';

export class JetpackImporter implements Importer {
	constructor( private backup: BackupContents ) {}

	async import( rootPath: string ): Promise< void > {
		await this.importDatabase();
		await this.importWpContent( rootPath );
		if ( this.backup.metaFile ) {
			await this.handleMetaFile();
		}
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

	private async handleMetaFile(): Promise< unknown > {
		const metaFilePath = this.backup.metaFile;
		if ( ! metaFilePath ) {
			return;
		}
		try {
			const metaContent = await fsPromises.readFile( metaFilePath, 'utf-8' );
			const meta = JSON.parse( metaContent );
			return meta;
		} catch ( e ) {
			return {};
		}
	}
}
