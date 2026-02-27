import fsPromises from 'fs/promises';
import os from 'os';
import path from 'path';
import { ImportExportEventData, handleEvents } from 'src/lib/import-export/handle-events';
import {
	BackupExtractEvents,
	ImporterEvents,
	ValidatorEvents,
} from 'src/lib/import-export/import/events';
import { BackupHandlerFactory } from 'src/lib/import-export/import/handlers/backup-handler-factory';
import {
	Importer,
	ImporterResult,
	JetpackImporter,
	LocalImporter,
	PlaygroundImporter,
	SQLImporter,
	WpressImporter,
} from 'src/lib/import-export/import/importers/importer';
import { BackupArchiveInfo, NewImporter } from 'src/lib/import-export/import/types';
import {
	JetpackValidator,
	SqlValidator,
	LocalValidator,
	PlaygroundValidator,
	WpressValidator,
} from 'src/lib/import-export/import/validators';
import { Validator } from 'src/lib/import-export/import/validators/validator';

interface ImporterOption {
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
): Promise< ImporterResult > {
	const backupHandler = BackupHandlerFactory.create( backupFile );
	if ( ! backupHandler ) {
		throw new Error( 'No suitable backup handler found for the provided backup file' );
	}

	const extractionDirectory = await fsPromises.mkdtemp( path.join( os.tmpdir(), 'studio_backup' ) );
	const fileList = await backupHandler.listFiles( backupFile );
	const importer = selectImporter( fileList, extractionDirectory, onEvent, options );

	if ( ! importer ) {
		throw new Error( 'No suitable importer found for the provided backup contents' );
	}

	let removeBackupListeners;
	let removeImportListeners;
	try {
		removeBackupListeners = handleEvents( backupHandler, onEvent, BackupExtractEvents );
		removeImportListeners = handleEvents( importer, onEvent, ImporterEvents );
		await backupHandler.extractFiles( backupFile, extractionDirectory );
		return await importer.import( site.path, site.id );
	} finally {
		removeBackupListeners?.();
		removeImportListeners?.();
		await fsPromises.rm( extractionDirectory, { recursive: true } );
	}
}

export const defaultImporterOptions: ImporterOption[] = [
	{ validator: new PlaygroundValidator(), importer: PlaygroundImporter },
	{ validator: new JetpackValidator(), importer: JetpackImporter },
	{ validator: new LocalValidator(), importer: LocalImporter },
	{ validator: new SqlValidator(), importer: SQLImporter },
	{ validator: new WpressValidator(), importer: WpressImporter },
];
