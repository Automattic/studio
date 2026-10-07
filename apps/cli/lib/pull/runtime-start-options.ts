/**
 * Translates reprint's output (runtime.php) into the StartServerOptions the
 * native PHP server uses for an imported site.
 */
import fs from 'fs';
import path from 'path';
import type { StartServerOptions } from 'cli/lib/wordpress-server-manager';

/**
 * Builds the start options for an imported site: reprint's generated
 * `runtime.php` loaded as a PHP `auto_prepend_file` (which wires SQLite the same
 * way the imported site's web server does), plus open_basedir access to the
 * technical site directory.
 *
 * Accepts anything carrying the imported-site fields — both `SiteData` and the
 * pull session metadata qualify. Returns undefined — never throws — for normal
 * `studio create` sites (no `runtimeBlueprintPath`) or when `runtime.php` is
 * absent, so callers decide whether that's fatal.
 */
export function loadImportedRuntimeStartOptions( site: {
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
