import fs from 'fs';
import path from 'path';

export const STATIC_SITE_IMPORT_DIR = '.studio-import';
export const STATIC_SITE_IMPORT_REQUEST_FILE = 'request.json';

export function staticSiteImportRequestPath( sitePath: string ): string {
	return path.join( sitePath, STATIC_SITE_IMPORT_DIR, STATIC_SITE_IMPORT_REQUEST_FILE );
}

export function staticSiteImportSourcePath( sitePath: string ): string {
	return path.join( sitePath, STATIC_SITE_IMPORT_DIR, 'source' );
}

export function removeStagedStaticSiteImport( sitePath: string ): void {
	fs.rmSync( path.join( sitePath, STATIC_SITE_IMPORT_DIR ), { recursive: true, force: true } );
}

/**
 * The request of an unfinished import of `sourceUrl` staged in `sitePath`, if there is one.
 * Its staged source travels with it, so resuming needs neither the original capture nor a new one.
 */
export function stagedUrlImport( sitePath: string, sourceUrl: string ): string | undefined {
	try {
		const request = fs.readFileSync( staticSiteImportRequestPath( sitePath ), 'utf-8' );
		const staged = JSON.parse( request ) as { source_metadata?: { source_path?: unknown } };
		return staged.source_metadata?.source_path === sourceUrl &&
			fs.existsSync( staticSiteImportSourcePath( sitePath ) )
			? request
			: undefined;
	} catch {
		return undefined;
	}
}
