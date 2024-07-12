import fsPromises from 'fs/promises';
import os from 'os';
import path from 'path';
import { BackupHandler } from './handlers/backup-handler';
import { Importer } from './importers/Importer';
import { BackupArchiveInfo, BackupContents } from './types';
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

function getExtractionDirectoryNameFromBackup( filePath: string ): string {
	const fileName = path.basename( filePath, path.extname( filePath ) );
	return path.join( os.tmpdir(), fileName );
}

export async function importBackup(
	backupFile: BackupArchiveInfo,
	sitePath: string,
	validators: Validator[],
	importers: { [ key: string ]: new ( backup: BackupContents ) => Importer }
): Promise< void > {
	const extractionDirectory = await fsPromises.mkdtemp(
		getExtractionDirectoryNameFromBackup( backupFile.path )
	);
	try {
		const backupHandler = new BackupHandler();
		const fileList = await backupHandler.listFiles( backupFile );
		const importer = selectImporter( fileList, extractionDirectory, validators, importers );

		if ( importer ) {
			await backupHandler.extractFiles( backupFile, extractionDirectory );
			await importer.import( sitePath );
		} else {
			throw new Error( 'No suitable importer found for the given backup file' );
		}
	} catch ( error ) {
		console.error( 'Backup import failed:', ( error as Error ).message );
		throw error;
	} finally {
		await fsPromises.rmdir( extractionDirectory );
	}
}
