import fs from 'fs';
import os from 'os';
import path from 'path';
import { SiteData } from 'cli/lib/cli-config/core';
import { ImportExportEventData, handleEvents } from '../handle-events';
import { BackupExtractEvents, ImporterEvents, ValidatorEvents } from './events';
import { BackupHandlerFactory } from './handlers/backup-handler-factory';
import {
	Importer,
	ImporterResult,
	JetpackImporter,
	LocalImporter,
	PlaygroundImporter,
	SQLImporter,
	WpressImporter,
} from './importers/importer';
import { BackupArchiveInfo, NewImporter } from './types';
import { JetpackValidator } from './validators/jetpack-validator';
import { LocalValidator } from './validators/local-validator';
import { PlaygroundValidator } from './validators/playground-validator';
import { SqlValidator } from './validators/sql-validator';
import { Validator } from './validators/validator';
import { WpressValidator } from './validators/wpress-validator';

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
	site: SiteData,
	onEvent: ( data: ImportExportEventData ) => void,
	options: ImporterOption[]
): Promise< ImporterResult > {
	const backupHandler = BackupHandlerFactory.create( backupFile );
	if ( ! backupHandler ) {
		throw new Error( 'No suitable backup handler found for the provided backup file' );
	}

	const extractionDirectory = await fs.promises.mkdtemp(
		path.join( os.tmpdir(), 'studio_backup' )
	);
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
		return await importer.import( site );
	} finally {
		removeBackupListeners?.();
		removeImportListeners?.();
		await fs.promises.rm( extractionDirectory, { recursive: true } );
	}
}

export const DEFAULT_IMPORTER_OPTIONS: ImporterOption[] = [
	{ validator: new PlaygroundValidator(), importer: PlaygroundImporter },
	{ validator: new JetpackValidator(), importer: JetpackImporter },
	{ validator: new LocalValidator(), importer: LocalImporter },
	{ validator: new SqlValidator(), importer: SQLImporter },
	{ validator: new WpressValidator(), importer: WpressImporter },
];
