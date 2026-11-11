import fs from 'fs';
import path from 'path';
import type { StartServerOptions } from 'cli/lib/wordpress-server-manager';

/**
 * Prepends Reprint's `runtime.php`, which sets up the pulled database, and
 * gives PHP access to the pull's files. Returns undefined for sites that
 * weren't pulled or have no `runtime.php`.
 */
export function getPulledSiteStartOptions( site: {
	technicalSiteDirectory?: string;
	runtimeBlueprintPath?: string;
} ): StartServerOptions | undefined {
	if ( ! site.runtimeBlueprintPath ) {
		return undefined;
	}
	const runtimePhpPath = path.join( path.dirname( site.runtimeBlueprintPath ), 'runtime.php' );
	if ( ! fs.existsSync( runtimePhpPath ) ) {
		return undefined;
	}

	return {
		autoPrependFile: runtimePhpPath,
		openBasedirAllowList: site.technicalSiteDirectory ? [ site.technicalSiteDirectory ] : [],
	};
}
