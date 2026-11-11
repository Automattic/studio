import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { writeFile } from 'atomically';
import { z } from 'zod';
import {
	lockAppConfig,
	readAppConfig,
	saveAppConfig,
	unlockAppConfig,
	type AppConfig,
} from './app-config';
import { DEFAULT_HIDE_FRONTEND_ADMIN_BAR } from './user-settings/preferences';
import { getMuPluginSettingsPath } from './well-known-paths';

const settingsSchema = z.object( {
	hideFrontendAdminBar: z.boolean().catch( DEFAULT_HIDE_FRONTEND_ADMIN_BAR ),
	siteMetadata: z
		.record(
			z.string(),
			z.object( { hideFrontendAdminBar: z.boolean().optional().catch( undefined ) } ).catch( {} )
		)
		.catch( {} ),
} );

async function writeRuntimeSettings( config: AppConfig ): Promise< void > {
	const settings = settingsSchema.parse( config );
	const content =
		JSON.stringify( {
			hideFrontendAdminBar: settings.hideFrontendAdminBar,
			sites: Object.fromEntries(
				Object.entries( settings.siteMetadata )
					.filter( ( [ , site ] ) => typeof site.hideFrontendAdminBar === 'boolean' )
					.map( ( [ id, site ] ) => [ id, site.hideFrontendAdminBar ] )
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

// Only the public runtime preferences reach PHP; app.json can contain private state.
export async function syncMuPluginSettings(): Promise< void > {
	await lockAppConfig();
	try {
		await writeRuntimeSettings( await readAppConfig() );
	} finally {
		await unlockAppConfig();
	}
}

export async function updateMuPluginSettings< T >(
	mutate: ( config: AppConfig ) => T
): Promise< T > {
	await lockAppConfig();
	try {
		const previous = await readAppConfig();
		const config = structuredClone( previous );
		const result = mutate( config );
		await writeRuntimeSettings( config );
		try {
			await saveAppConfig( config );
		} catch ( error ) {
			await writeRuntimeSettings( previous );
			throw error;
		}
		return result;
	} finally {
		await unlockAppConfig();
	}
}
