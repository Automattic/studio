import { format } from 'date-fns';
import { sanitizeFolderName } from 'src/lib/generate-site-name';

export function generateBackupFilename( name: string ) {
	const timestamp = format( new Date(), 'yyyy-MM-dd-HH-mm-ss' );
	return sanitizeFolderName( `studio-backup-${ name }-${ timestamp }` );
}
