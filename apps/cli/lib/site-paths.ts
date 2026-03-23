import os from 'os';
import path from 'path';
import { sanitizeFolderName } from '@studio/common/lib/sanitize-folder-name';

export const STUDIO_SITES_ROOT = path.join( os.homedir(), 'Studio' );

export function getDefaultSitePath( siteName: string ): string {
	const folderName = sanitizeFolderName( siteName );
	return path.join( STUDIO_SITES_ROOT, folderName );
}
