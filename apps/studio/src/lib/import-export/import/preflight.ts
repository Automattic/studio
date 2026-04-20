import fs from 'fs';
import { BackupHandlerFactory } from 'src/lib/import-export/import/handlers/backup-handler-factory';
import { JetpackValidator } from 'src/lib/import-export/import/validators/jetpack-validator';
import { LocalValidator } from 'src/lib/import-export/import/validators/local-validator';
import { PlaygroundValidator } from 'src/lib/import-export/import/validators/playground-validator';
import { SqlValidator } from 'src/lib/import-export/import/validators/sql-validator';
import { WpressValidator } from 'src/lib/import-export/import/validators/wpress-validator';

export type BackupFormat = 'jetpack' | 'local' | 'playground' | 'sql' | 'wpress';

export type BackupPreflightResult =
	| { valid: true; format: BackupFormat; fileCount: number }
	| { valid: false; reason: string };

const VALIDATORS: ReadonlyArray< {
	validator: { canHandle: ( fileList: string[] ) => boolean };
	format: BackupFormat;
} > = [
	{ validator: new PlaygroundValidator(), format: 'playground' },
	{ validator: new JetpackValidator(), format: 'jetpack' },
	{ validator: new LocalValidator(), format: 'local' },
	{ validator: new SqlValidator(), format: 'sql' },
	{ validator: new WpressValidator(), format: 'wpress' },
];

export async function preflightBackupFile(
	filePath: string,
	fileType: string = ''
): Promise< BackupPreflightResult > {
	if ( ! fs.existsSync( filePath ) ) {
		return { valid: false, reason: 'The selected file no longer exists.' };
	}

	const handler = BackupHandlerFactory.create( { path: filePath, type: fileType } );
	if ( ! handler ) {
		return {
			valid: false,
			reason: 'Unsupported file type. Use a .zip, .tar.gz, .sql, or .wpress file.',
		};
	}

	let fileList: string[];
	try {
		fileList = await handler.listFiles( { path: filePath, type: fileType } );
	} catch ( err ) {
		const message = err instanceof Error ? err.message : String( err );
		return { valid: false, reason: `Could not read the archive: ${ message }` };
	}

	if ( fileList.length === 0 ) {
		return { valid: false, reason: 'The archive is empty.' };
	}

	for ( const { validator, format } of VALIDATORS ) {
		if ( validator.canHandle( fileList ) ) {
			return { valid: true, format, fileCount: fileList.length };
		}
	}

	return {
		valid: false,
		reason:
			"The file doesn't match a recognized backup format (Jetpack, Local, Playground, .wpress, or .sql).",
	};
}
