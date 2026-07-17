import { ACCEPTED_IMPORT_FILE_TYPES } from '@studio/common/constants';

export function isSupportedBackupFilename( filename: string ): boolean {
	const lower = filename.toLowerCase();
	return ACCEPTED_IMPORT_FILE_TYPES.some( ( extension ) => lower.endsWith( extension ) );
}

export function getSuggestedSiteNameFromBackupFilename( filename: string ): string {
	const basename = filename.replace( /^.*[\\/]/, '' );
	const lower = basename.toLowerCase();
	const extension = ACCEPTED_IMPORT_FILE_TYPES.find( ( candidate ) => lower.endsWith( candidate ) );
	const stem = extension ? basename.slice( 0, -extension.length ) : basename;

	return stem
		.replace( /^studio[-_\s]+backup[-_\s]+/i, '' )
		.replace( /^(backup|export)[-_\s]+/i, '' )
		.replace( /[-_\s]+\d{4}[-_]\d{2}[-_]\d{2}(?:[T_-]\d{2}){0,3}(?:Z)?(?:[-_\s].*)?$/i, '' )
		.replace( /[-_\s]+(backup|export|wordpress|jetpack)s?$/i, '' )
		.replace( /[-_]+/g, ' ' )
		.replace( /\s+/g, ' ' )
		.trim();
}
