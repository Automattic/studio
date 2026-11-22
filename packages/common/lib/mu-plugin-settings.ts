import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { writeFile } from 'atomically';
import { readConfig, updateConfig } from './config/store';
import { DEFAULT_HIDE_FRONTEND_ADMIN_BAR } from './user-settings/preferences';
import { getMuPluginSettingsPath } from './well-known-paths';
import type { Config } from './config/schema';

// Only the public runtime preferences reach PHP; the config file holds private state.
export async function syncMuPluginSettings(): Promise< void > {
	const { preferences, sites } = await readConfig();
	const content =
		JSON.stringify( {
			hideFrontendAdminBar:
				typeof preferences.hideFrontendAdminBar === 'boolean'
					? preferences.hideFrontendAdminBar
					: DEFAULT_HIDE_FRONTEND_ADMIN_BAR,
			sites: Object.fromEntries(
				sites
					.filter( ( site ) => typeof site.hideFrontendAdminBar === 'boolean' )
					.map( ( site ) => [ site.id, site.hideFrontendAdminBar ] )
			),
		} ) + '\n';
	const settingsPath = getMuPluginSettingsPath();
	try {
		if ( ( await readFile( settingsPath, 'utf8' ) ) === content ) return;
	} catch {
		// Missing or unreadable; the atomic write below reports a failure.
	}
	await mkdir( path.dirname( settingsPath ), { recursive: true } );
	await writeFile( settingsPath, content, 'utf8' );
}

// For updates that can change what PHP reads.
export async function updateConfigAndMuPluginSettings< T >(
	update: ( config: Config ) => T
): Promise< T > {
	const result = await updateConfig( update );
	await syncMuPluginSettings();
	return result;
}
