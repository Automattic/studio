import { ACCEPTED_IMPORT_FILE_TYPES } from '@studio/common/constants';

export function isValidBackupFile( file: File ): boolean {
	const lower = file.name.toLowerCase();
	return ACCEPTED_IMPORT_FILE_TYPES.some( ( ext ) => lower.endsWith( ext ) );
}

/**
 * Derives a friendly default site name from a backup filename. Strips the
 * archive extension and common "site-backup-2024-01-01" date suffixes so the
 * form can seed the site name without the user having to retype it.
 */
export function nameFromFilename( filename: string ): string {
	const basename = filename.replace( /^.*[\\/]/, '' );
	const lower = basename.toLowerCase();
	const ext = ACCEPTED_IMPORT_FILE_TYPES.find( ( candidate ) => lower.endsWith( candidate ) );
	return ( ext ? basename.slice( 0, -ext.length ) : basename )
		.replace( /[-_]\d{4}[-_]\d{2}[-_]\d{2}.*$/, '' )
		.replace( /[-_](backup|export|wordpress|jetpack)(s)?$/i, '' )
		.replace( /[-_]+/g, ' ' )
		.trim();
}
