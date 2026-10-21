import os from 'os';
import path from 'path';
import { sanitizeFolderName } from '@studio/common/lib/sanitize-folder-name';

// The eval runner gives each case its own sites root (E2E_SITES_ROOT), so
// concurrent cases never share a site folder.
export const STUDIO_SITES_ROOT =
	process.env.E2E && process.env.E2E_SITES_ROOT
		? process.env.E2E_SITES_ROOT
		: path.join( os.homedir(), 'Studio' );

export function getDefaultSitePath( siteName: string ): string {
	const folderName = sanitizeFolderName( siteName );
	return path.join( STUDIO_SITES_ROOT, folderName );
}
