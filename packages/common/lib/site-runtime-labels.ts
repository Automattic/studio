import { __ } from '@wordpress/i18n';
import {
	SITE_FILE_ACCESS_ALL_FILES,
	type SiteFileAccess,
} from '@studio/common/lib/site-file-access';

// Copy for the file access controls, shared by the agentic UI and the Classic
// renderer so translators only see one phrasing. Kept out of
// `site-file-access.ts` so that wire schema stays free of display copy —
// `cli-events.ts` imports it, and everything parsing a site record would
// otherwise pull @wordpress/i18n along with it. Each one is a function so the
// Classic renderer, which swaps locale data live, re-reads it on render.

export function getSiteDirectoryFileAccessLabel(): string {
	/* translators: File access option, paired with "All files". PHP may only reach the site's own directory. */
	return __( 'Site directory' );
}

export function getAllFilesFileAccessLabel(): string {
	/* translators: File access option, paired with "Site directory". PHP may reach any file on the machine. */
	return __( 'All files' );
}

export function getFileAccessDescription( fileAccess: SiteFileAccess ): string {
	if ( fileAccess === SITE_FILE_ACCESS_ALL_FILES ) {
		return __( 'PHP can access any file on your system.' );
	}
	return __( "Restricts the site's file access to the site directory." );
}
