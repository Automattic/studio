import path from 'path';
import { BackupHandler } from './handlers/BackupHandler';
import { Importer } from './importers/Importer';
import { BackupArchiveInfo, DbConfig, BackupContents } from './types';
import { Validator } from './validators/Validator';

export function selectImporter(
	allFiles: string[],
	extractionDirectory: string,
	validators: Validator[],
	importers: { [ key: string ]: new ( backup: BackupContents ) => Importer }
): Importer | null {
	for ( const validator of validators ) {
		if ( validator.canHandle( allFiles ) ) {
			const importerClass = importers[ validator.constructor.name ];
			if ( importerClass ) {
				const files = validator.parseBackupContents( allFiles, extractionDirectory );
				return new importerClass( files );
			}
		}
	}
	return null;
}

export async function importBackup(
	file: BackupArchiveInfo,
	rootPath: string,
	dbConfig: DbConfig,
	validators: Validator[],
	importers: { [ key: string ]: new ( backup: BackupContents ) => Importer }
): Promise< void > {
	try {
		const backupHandler = new BackupHandler();
		const fileList = await backupHandler.listFiles( file );
		const extractDir = path.join( path.dirname( file.path ), 'extracted' );
		const importer = selectImporter( fileList, extractDir, validators, importers );

		if ( importer ) {
			await backupHandler.extractFiles( file, extractDir );
			await importer.import( rootPath, dbConfig );
			console.log( 'Backup imported successfully' );
		} else {
			throw new Error( 'No suitable importer found for the given backup file' );
		}
	} catch ( error ) {
		console.error( 'Backup import failed:', ( error as Error ).message );
		throw error;
	}
}
