// src/platform/load-external.ts
//
// Loads consumer-defined platform modules at boot — the bridge that lets an
// INSTALLED Data Liberation (e.g. the Claude Code plugin's MCP server, which
// third-party code cannot import into) pick up custom platforms:
//
//   DATA_LIBERATION_PLATFORMS=/abs/path/acme-platform.mjs,other-module.mjs
//
// Each entry is an ES module whose default initializer receives the registry
// API. Passing the API in is important for the self-contained MCP bundle: a
// module importing the package root would otherwise mutate dist/index.js's
// separate module instance rather than the registry in the running bundle.
// Paths are resolved relative to the current working directory; bare
// specifiers are imported as-is. Failures are reported, never fatal — one bad
// module must not take the server (or the built-in platforms) down.
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { registerPlatform } from './registry.js';
import type { Platform, RegisterPlatformOptions } from './types.js';

export const EXTERNAL_PLATFORMS_ENV = 'DATA_LIBERATION_PLATFORMS';

export interface ExternalPlatformLoadResult {
	loaded: string[];
	failed: Array<{ entry: string; error: string }>;
}

export interface ExternalPlatformApi {
	registerPlatform( platform: Platform, options?: RegisterPlatformOptions ): Platform;
}

export type ExternalPlatformInitializer = (
	api: ExternalPlatformApi,
) => void | Promise< void >;

const externalPlatformApi: ExternalPlatformApi = Object.freeze( { registerPlatform } );

function isPathLike( entry: string ): boolean {
	return entry.startsWith( '.' ) || entry.startsWith( '/' ) || /^[a-zA-Z]:[\\/]/.test( entry );
}

/**
 * Import every module named in DATA_LIBERATION_PLATFORMS. Split entries on
 * commas and/or whitespace. Each module registers itself with the platform
 * registry through its default initializer (duplicate/conflicting
 * registrations surface as rejections from registerPlatform, reported
 * per-entry here).
 */
export async function loadExternalPlatforms(
	env: NodeJS.ProcessEnv = process.env,
): Promise< ExternalPlatformLoadResult > {
	const raw = env[ EXTERNAL_PLATFORMS_ENV ];
	const result: ExternalPlatformLoadResult = { loaded: [], failed: [] };
	if ( ! raw || raw.trim() === '' ) return result;

	const entries = raw.split( /[\s,]+/ ).filter( Boolean );
	for ( const entry of entries ) {
		try {
			const specifier = isPathLike( entry )
				? pathToFileURL( resolve( entry ) ).href
				: entry;
			const module = await import( specifier ) as { default?: unknown };
			if ( typeof module.default !== 'function' ) {
				throw new Error( 'External platform module must export a default initializer function' );
			}
			await ( module.default as ExternalPlatformInitializer )( externalPlatformApi );
			result.loaded.push( entry );
		} catch ( err ) {
			result.failed.push( {
				entry,
				error: err instanceof Error ? err.message : String( err ),
			} );
		}
	}
	return result;
}
