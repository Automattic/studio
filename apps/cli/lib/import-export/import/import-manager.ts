import fs from 'fs';
import os from 'os';
import path from 'path';
import {
	BackupExtractEvents,
	ImporterEvents,
	ValidatorEvents,
} from '@studio/common/lib/import-export-events';
import { __ } from '@wordpress/i18n';
import { SiteData } from 'cli/lib/cli-config/core';
import { ImportExportEventEmitter } from '../events';
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
import { WxrImporter } from './importers/wxr-importer';
import { resetSqliteJournalModeToRollback } from './reset-sqlite-journal-mode';
import { BackupArchiveInfo, NewImporter } from './types';
import { JetpackValidator } from './validators/jetpack-validator';
import { LocalValidator } from './validators/local-validator';
import { PlaygroundValidator } from './validators/playground-validator';
import { SqlValidator } from './validators/sql-validator';
import { Validator } from './validators/validator';
import { WpressValidator } from './validators/wpress-validator';
import { XmlValidator } from './validators/xml-validator';

interface ImporterOption {
	validator: Validator;
	importer: NewImporter;
}

function selectImporter(
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

class BackupImporter extends ImportExportEventEmitter implements Importer {
	constructor(
		private backupFile: BackupArchiveInfo,
		private importerOptions: ImporterOption[]
	) {
		super();
	}

	async import( site: SiteData ): Promise< ImporterResult > {
		const backupHandler = BackupHandlerFactory.create( this.backupFile );
		if ( ! backupHandler ) {
			throw new Error( __( 'No suitable backup handler found for the provided backup file' ) );
		}

		const extractionDirectory = await fs.promises.mkdtemp(
			path.join( os.tmpdir(), 'studio_backup' )
		);

		try {
			const fileList = await backupHandler.listFiles( this.backupFile );
			this.emit( ValidatorEvents.IMPORT_VALIDATION_START );
			const importer = selectImporter( fileList, extractionDirectory, this.importerOptions );

			if ( ! importer ) {
				throw new Error( __( 'No suitable importer found for the provided backup contents' ) );
			}
			this.emit( ValidatorEvents.IMPORT_VALIDATION_COMPLETE );

			for ( const eventName of Object.values( BackupExtractEvents ) ) {
				backupHandler.on( eventName, ( data ) => this.emit( eventName, data ) );
			}

			for ( const eventName of Object.values( ImporterEvents ) ) {
				importer.on( eventName, ( data ) => this.emit( eventName, data ) );
			}

			await backupHandler.extractFiles( this.backupFile, extractionDirectory );

			const result = await importer.import( site );

			// Importers write the SQLite database through the AST driver, which
			// leaves it in WAL journal mode. Playground can't reopen a WAL database
			// through PHP-WASM on Windows, so a later restart — an import or pull
			// into a running site — fails to connect. Normalize to rollback mode
			// here: the single point every importer and both `import` and `pull`
			// funnel through, before the caller restarts the server.
			await resetSqliteJournalModeToRollback( site.path );

			return result;
		} finally {
			await fs.promises.rm( extractionDirectory, { recursive: true } );
		}
	}
}

export function getImporter( backupFile: BackupArchiveInfo, options: ImporterOption[] ): Importer {
	return new BackupImporter( backupFile, options );
}

export const DEFAULT_IMPORTER_OPTIONS: ImporterOption[] = [
	{ validator: new PlaygroundValidator(), importer: PlaygroundImporter },
	{ validator: new JetpackValidator(), importer: JetpackImporter },
	{ validator: new LocalValidator(), importer: LocalImporter },
	{ validator: new SqlValidator(), importer: SQLImporter },
	{ validator: new XmlValidator(), importer: WxrImporter },
	{ validator: new WpressValidator(), importer: WpressImporter },
];
