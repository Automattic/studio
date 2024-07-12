import fsPromises from 'fs/promises';
import os from 'os';
import path from 'path';
import { BackupHandlerFactory } from './handlers/backup-handler-factory';
import { Importer, ImporterResult } from './importers/Importer';
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

export async function importBackup(
	backupFile: BackupArchiveInfo,
	sitePath: string,
	validators: Validator[],
	importers: { [ key: string ]: new ( backup: BackupContents ) => Importer }
): Promise< ImporterResult > {
	const extractionDirectory = await fsPromises.mkdtemp( path.join( os.tmpdir(), 'studio_backup' ) );
	try {
		const backupHandler = BackupHandlerFactory.create( backupFile );
		const fileList = await backupHandler.listFiles( backupFile );
		const importer = selectImporter( fileList, extractionDirectory, validators, importers );

		if ( importer ) {
			await backupHandler.extractFiles( backupFile, extractionDirectory );
			return await importer.import( sitePath );
		} else {
			throw new Error( 'No suitable importer found for the given backup file' );
		}
	} catch ( error ) {
		console.error( 'Backup import failed:', ( error as Error ).message );
		throw error;
	} finally {
		await fsPromises.rm( extractionDirectory, { recursive: true } );
	}
}
