import fsPromises from 'fs/promises';
import os from 'os';
import path from 'path';
import { ImportExportEventData, handleEvents } from '../handle-events';
import { BackupExtractEvents, ImporterEvents, ValidatorEvents } from './events';
import { BackupHandlerFactory } from './handlers/backup-handler-factory';
import { DefaultImporter, Importer, ImporterResult } from './importers/importer';
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

async function extractBackupFile(
	backupFile: BackupArchiveInfo,
	extractionDirectory: string,
	onEvent: ( data: ImportExportEventData ) => void,
	options: ImporterOption[]
) {
	const backupHandler = BackupHandlerFactory.create( backupFile );
	const fileList = await backupHandler.listFiles( backupFile );
	const importer = selectImporter( fileList, extractionDirectory, onEvent, options );
	if ( importer ) {
		await backupHandler.extractFiles( backupFile, extractionDirectory );
	}

	return { importer, backupHandler };
}

async function createExtractionDirectory() {
	const extractionDirectory = await fsPromises.mkdtemp( path.join( os.tmpdir(), 'studio_backup' ) );
	const removeExtractionDirectory = async () => {
		await fsPromises.rm( extractionDirectory, { recursive: true } );
	};
	return { extractionDirectory, removeExtractionDirectory };
}

export async function importBackup(
	backupFile: BackupArchiveInfo,
	sitePath: string,
	onEvent: ( data: ImportExportEventData ) => void,
	options: ImporterOption[]
): Promise< ImporterResult > {
	const { extractionDirectory, removeExtractionDirectory } = await createExtractionDirectory();
	let removeBackupListeners: ( () => void ) | undefined;
	let removeImportListeners: ( () => void ) | undefined;

	try {
		const { importer, backupHandler } = await extractBackupFile(
			backupFile,
			extractionDirectory,
			onEvent,
			options
		);

		if ( ! importer ) {
			throw new Error( 'No suitable importer found for the given backup file' );
		}

		removeBackupListeners = handleEvents( backupHandler, onEvent, BackupExtractEvents );
		removeImportListeners = handleEvents( importer, onEvent, ImporterEvents );

		return await importer.import( sitePath );
	} catch ( error ) {
		console.error( 'Backup import failed:', ( error as Error ).message );
		throw error;
	} finally {
		removeBackupListeners?.();
		removeImportListeners?.();
		await removeExtractionDirectory();
	}
}

export async function getMetaFromBackupFile( backupFile: BackupArchiveInfo ) {
	const { extractionDirectory, removeExtractionDirectory } = await createExtractionDirectory();
	// eslint-disable-next-line @typescript-eslint/no-empty-function
	const silentOnEvent = () => {};

	try {
		const { importer } = await extractBackupFile(
			backupFile,
			extractionDirectory,
			silentOnEvent,
			defaultImporterOptions
		);

		if ( ! importer ) {
			return { phpVersion: '', wordpressVersion: '' };
		}

		const studioJsonObject = await importer.parseMetaFile();
		return {
			phpVersion: studioJsonObject?.phpVersion || '',
			wordpressVersion: studioJsonObject?.wordpressVersion || '',
		};
	} finally {
		await removeExtractionDirectory();
	}
}

export const defaultImporterOptions: ImporterOption[] = [
	{ validator: new JetpackValidator(), importer: DefaultImporter },
	{ validator: new SqlValidator(), importer: DefaultImporter },
];
