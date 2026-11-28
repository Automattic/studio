import { readFileSync } from 'fs';
import path from 'path';

// The plugin the `curate-admin` skill writes for a site, holding its manifest.
export const CURATE_ADMIN_SITE_PLUGIN = 'curate-admin-site';

export function getCurateAdminManifestPath( sitePath: string ): string {
	return path.join(
		sitePath,
		'wp-content',
		'plugins',
		CURATE_ADMIN_SITE_PLUGIN,
		'curate-admin.json'
	);
}

/**
 * The login of a site's Staff account, when the site has a curated wp-admin.
 * Read each time rather than stored, so it can't disagree with the site.
 */
export function getStaffAdminLogin( sitePath: string ): string | undefined {
	try {
		const manifest = JSON.parse( readFileSync( getCurateAdminManifestPath( sitePath ), 'utf8' ) );
		return typeof manifest.staff?.login === 'string' ? manifest.staff.login : undefined;
	} catch {
		return undefined;
	}
}
