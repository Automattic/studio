import fsPromises from 'fs/promises';
import os from 'os';
import path from 'path';
import { ImportExportEventData, handleEvents } from '../handle-events';
import { BackupExtractEvents, ImporterEvents, ValidatorEvents } from './events';
import { BackupHandlerFactory } from './handlers/backup-handler-factory';
import { Importer, ImporterResult, JetpackImporter, SQLImporter } from './importers/importer';
import { BackupArchiveInfo, NewImporter } from './types';
import { JetpackValidator, SqlValidator } from './validators';
import { Validator } from './validators/validator';

export interface ImporterOption {
	validator: Validator;
	importer: NewImporter;
}

export function selectImporter(
	allFiles: string[],
	extractionDirectory: string,
	onEvent: ( data: ImportExportEventData ) => void,
	options: ImporterOption[]
): Importer | null {
	for ( const { validator, importer } of options ) {
		if ( validator.canHandle( allFiles ) ) {
			const removeValidatorListeners = handleEvents( validator, onEvent, ValidatorEvents );
			const files = validator.parseBackupContents( allFiles, extractionDirectory );
			removeValidatorListeners();
			return new importer( files );
		}
	}
	return null;
}

export async function importBackup(
	backupFile: BackupArchiveInfo,
	site: SiteDetails,
	onEvent: ( data: ImportExportEventData ) => void,
	options: ImporterOption[]
): Promise< ImporterResult | undefined > {
	const extractionDirectory = await fsPromises.mkdtemp( path.join( os.tmpdir(), 'studio_backup' ) );
	let removeBackupListeners;
	let removeImportListeners;
	try {
		const backupHandler = BackupHandlerFactory.create( backupFile );
		const fileList = await backupHandler.listFiles( backupFile );
		const importer = selectImporter( fileList, extractionDirectory, onEvent, options );

		if ( importer ) {
			removeBackupListeners = handleEvents( backupHandler, onEvent, BackupExtractEvents );
			removeImportListeners = handleEvents( importer, onEvent, ImporterEvents );
			await backupHandler.extractFiles( backupFile, extractionDirectory );
			return await importer.import( site.path, site.id );
		} else {
			return;
		}
	} catch ( error ) {
		console.error( 'Backup import failed:', ( error as Error ).message );
		throw error;
	} finally {
		removeBackupListeners?.();
		removeImportListeners?.();
		await fsPromises.rm( extractionDirectory, { recursive: true } );
	}
}

export const defaultImporterOptions: ImporterOption[] = [
	{ validator: new JetpackValidator(), importer: JetpackImporter },
	{ validator: new SqlValidator(), importer: SQLImporter },
];
