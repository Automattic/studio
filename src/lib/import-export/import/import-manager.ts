import fsPromises from 'fs/promises';
import os from 'os';
import path from 'path';
import { BackupHandlerFactory } from './handlers/backup-handler-factory';
import { Importer, ImporterResult } from './importers/importer';
import { BackupArchiveInfo, BackupContents } from './types';
import { Validator } from './validators/validator';

export interface ImporterOption {
	validator: Validator;
	importer: new ( backup: BackupContents ) => Importer;
}

export function selectImporter(
	allFiles: string[],
	extractionDirectory: string,
	options: ImporterOption[]
): Importer | null {
	for ( const { validator, importer } of options ) {
		if ( validator.canHandle( allFiles ) ) {
			const files = validator.parseBackupContents( allFiles, extractionDirectory );
			return new importer( files );
		}
	}
	return null;
}

export async function importBackup(
	backupFile: BackupArchiveInfo,
	sitePath: string,
	options: ImporterOption[]
): Promise< ImporterResult > {
	const extractionDirectory = await fsPromises.mkdtemp( path.join( os.tmpdir(), 'studio_backup' ) );
	try {
		const backupHandler = BackupHandlerFactory.create( backupFile );
		const fileList = await backupHandler.listFiles( backupFile );
		const importer = selectImporter( fileList, extractionDirectory, options );

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
