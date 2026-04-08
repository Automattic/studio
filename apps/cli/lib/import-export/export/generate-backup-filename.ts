import { sanitizeFolderName } from '@studio/common/lib/sanitize-folder-name';
import { format } from 'date-fns';

export function generateBackupFilename( name: string ) {
	const timestamp = format( new Date(), 'yyyy-MM-dd-HH-mm-ss' );
	return sanitizeFolderName( `studio-backup-${ name }-${ timestamp }` );
}
