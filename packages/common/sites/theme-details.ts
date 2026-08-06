import fs from 'node:fs/promises';
import { parseJsonFromPhpOutput } from '@studio/common/lib/php-output-parser';
import { getAppConfigPath } from '@studio/common/lib/well-known-paths';
import { z } from 'zod';
import type { ExecuteCliCommand } from '@studio/common/lib/cli-process';

// Theme details drive which "Customize" shortcuts a site offers (block themes
// get the Site Editor screens, classic themes get the Customizer plus whatever
// the theme registers). The desktop reads them through its own `SiteServer`;
// this module is how the `studio ui` server gets the same answer.

export const themeDetailsSchema = z.object( {
	name: z.string().catch( '' ),
	path: z.string(),
	slug: z.string(),
	isBlockTheme: z.boolean(),
	// The desktop's WP-CLI command always reports these; older persisted
	// records predate them.
	supportsWidgets: z.boolean().optional(),
	supportsMenus: z.boolean().optional(),
} );

export type ThemeDetails = z.infer< typeof themeDetailsSchema >;

// A cold PHP boot for a stopped site is slow but bounded; past this the answer
// isn't coming and the caller is better off reporting "unknown".
const FETCH_TIMEOUT_MS = 45_000;

/**
 * Read the active theme's details from a site by running the Studio mu-plugin's
 * `wp studio get-theme-details` command through the CLI. Works whether or not
 * the site's server is running — a stopped site gets a one-off PHP runtime.
 *
 * Resolves to `undefined` when the command fails or reports something that
 * isn't theme details, so callers can treat it as "not known" rather than
 * having to catch.
 */
export function fetchThemeDetails(
	execute: ExecuteCliCommand,
	sitePath: string
): Promise< ThemeDetails | undefined > {
	return new Promise( ( resolve ) => {
		const [ emitter, child ] = execute(
			[ 'wp', '--path', sitePath, 'studio', 'get-theme-details' ],
			{ output: 'capture' }
		);

		const timeout = setTimeout( () => {
			child.kill();
			resolve( undefined );
		}, FETCH_TIMEOUT_MS );

		const settle = ( details: ThemeDetails | undefined ) => {
			clearTimeout( timeout );
			resolve( details );
		};

		emitter.on( 'success', ( event ) => {
			settle( parseThemeDetails( event?.result?.stdout ) );
		} );
		emitter.on( 'failure', () => settle( undefined ) );
		emitter.on( 'error', () => settle( undefined ) );
	} );
}

function parseThemeDetails( stdout: string | undefined ): ThemeDetails | undefined {
	if ( ! stdout ) {
		return undefined;
	}
	try {
		return themeDetailsSchema.parse( parseJsonFromPhpOutput( stdout ) );
	} catch {
		return undefined;
	}
}

/**
 * Theme details the desktop app has already resolved and persisted to its own
 * config, keyed by site id. The CLI never writes `app.json`, but reading it
 * means a site the desktop has run once answers instantly here too.
 */
export async function readPersistedThemeDetails(): Promise< Record< string, ThemeDetails > > {
	let raw: string;
	try {
		raw = await fs.readFile( getAppConfigPath(), 'utf-8' );
	} catch {
		return {};
	}

	const parsed = persistedThemeDetailsSchema.safeParse( safeJsonParse( raw ) );
	if ( ! parsed.success ) {
		return {};
	}

	const details: Record< string, ThemeDetails > = {};
	for ( const [ siteId, metadata ] of Object.entries( parsed.data.siteMetadata ?? {} ) ) {
		if ( metadata.themeDetails ) {
			details[ siteId ] = metadata.themeDetails;
		}
	}
	return details;
}

const persistedThemeDetailsSchema = z.object( {
	siteMetadata: z
		.record( z.string(), z.object( { themeDetails: themeDetailsSchema.optional() } ) )
		.optional(),
} );

function safeJsonParse( raw: string ): unknown {
	try {
		return JSON.parse( raw );
	} catch {
		return undefined;
	}
}
