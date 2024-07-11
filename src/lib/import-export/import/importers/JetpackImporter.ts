import fsPromises from 'fs/promises';
import path from 'path';
import { BackupContents, DbConfig } from '../types';
import { Importer } from './Importer';

export class JetpackImporter implements Importer {
	constructor( private backup: BackupContents ) {}

	async import( rootPath: string, dbConfig: DbConfig ): Promise< void > {
		await this.importDatabase( dbConfig );
		await this.importWpContent( rootPath );
		if ( this.backup.metaFile ) {
			await this.handleMetaFile();
		}
	}

	private async importDatabase( _dbConfig: DbConfig ): Promise< void > {
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

	private async handleMetaFile(): Promise< void > {
		const metaFilePath = this.backup.metaFile;
		if ( ! metaFilePath ) {
			return;
		}
		const metaContent = await fsPromises.readFile( metaFilePath, 'utf-8' );
		const meta = JSON.parse( metaContent );
		console.log( 'Desired PHP version:', meta.phpVersion );
		console.log( 'Desired WordPress version:', meta.wpVersion );
	}
}
