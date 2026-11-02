import { readFileSync } from 'fs';
import path from 'path';

// The plugin the `client-admin` skill writes for a site, holding its manifest.
export const CLIENT_ADMIN_SITE_PLUGIN = 'client-admin-site';

export function getClientAdminManifestPath( sitePath: string ): string {
	return path.join(
		sitePath,
		'wp-content',
		'plugins',
		CLIENT_ADMIN_SITE_PLUGIN,
		'client-admin.json'
	);
}

/**
 * The login of a site's client account, when the site has a curated wp-admin.
 * Read each time rather than stored, so it can't disagree with the site.
 */
export function getClientAdminLogin( sitePath: string ): string | undefined {
	try {
		const manifest = JSON.parse( readFileSync( getClientAdminManifestPath( sitePath ), 'utf8' ) );
		return typeof manifest.client?.login === 'string' ? manifest.client.login : undefined;
	} catch {
		return undefined;
	}
}
