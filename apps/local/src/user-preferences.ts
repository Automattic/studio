import { readAppConfig, updateAppConfig } from '@studio/common/lib/app-config';
import { isSupportedLocale } from '@studio/common/lib/locale';
import {
	isAnalyticsOptedOutInConfig,
	readSharedConfig,
	updateSharedConfig,
} from '@studio/common/lib/shared-config';
import { SUPPORTED_EDITORS } from '@studio/common/lib/user-settings/editor';
import { getFirstInstalledEditor } from '@studio/common/lib/user-settings/installed-apps';
import {
	DEFAULT_COLOR_SCHEME,
	QUIT_SITES_BEHAVIORS,
	SUPPORTED_COLOR_SCHEMES,
} from '@studio/common/lib/user-settings/preferences';
import { DEFAULT_TERMINAL, SUPPORTED_TERMINALS } from '@studio/common/lib/user-settings/terminal';
import { z } from 'zod';
import type { SupportedEditor } from '@studio/common/lib/user-settings/editor';
import type { InstalledApps } from '@studio/common/lib/user-settings/installed-apps';
import type { ColorScheme, QuitSitesBehavior } from '@studio/common/lib/user-settings/preferences';
import type { SupportedTerminal } from '@studio/common/lib/user-settings/terminal';

/**
 * Global preferences for the `studio ui` browser app, read from and written to
 * the same files the desktop app uses — `app.json` for the UI preferences and
 * `shared.json` for locale and the analytics opt-out. Both front ends therefore
 * show one set of values instead of the browser keeping its own copy.
 *
 * The defaults mirror the desktop's user-settings handlers
 * (`apps/studio/src/modules/user-settings/lib/ipc-handlers.ts`) so a preference
 * the user has never touched reads the same on either side.
 */

export interface UserPreferences {
	editor: SupportedEditor | null;
	terminal: SupportedTerminal | null;
	colorScheme: ColorScheme;
	quitSitesBehavior?: QuitSitesBehavior;
	locale: string | undefined;
	analyticsEnabled: boolean;
	defaultSiteDirectory: string;
	agenticFeaturesEnabled: boolean;
}

// What `readUserPreferences` needs from the server. Both are passed in rather
// than resolved here so this stays a pure reader over the config files.
export interface UserPreferencesContext {
	// Where the server creates sites — the default-site-directory fallback
	// (the desktop's `defaultSitePath`).
	sitesRoot: string;
	// Editors/terminals present on this machine, for the unset-editor fallback.
	installedApps: InstalledApps;
}

// Built once: `.catch()`/`.optional()` each return a fresh schema, and these
// resolve on every preferences request.
const editorSchema = z.enum( SUPPORTED_EDITORS );
const terminalWithDefault = z.enum( SUPPORTED_TERMINALS ).catch( DEFAULT_TERMINAL );
const colorSchemeWithDefault = z.enum( SUPPORTED_COLOR_SCHEMES ).catch( DEFAULT_COLOR_SCHEME );
const optionalQuitSitesBehavior = z.enum( QUIT_SITES_BEHAVIORS ).optional().catch( undefined );
const nonEmptyString = z.string().nonempty();

// `null` clears a preference. JSON drops `undefined` keys, so an explicit clear
// (no preferred editor, "ask every time" on quit) has to travel as null.
export const userPreferencesPatchSchema = z.object( {
	editor: editorSchema.nullish(),
	terminal: z.enum( SUPPORTED_TERMINALS ).nullish(),
	colorScheme: z.enum( SUPPORTED_COLOR_SCHEMES ).nullish(),
	quitSitesBehavior: z.enum( QUIT_SITES_BEHAVIORS ).nullish(),
	// Only locales we ship translations for, so the route rejects the rest
	// instead of returning 204 for a write it silently drops.
	locale: z.string().refine( isSupportedLocale ).nullish(),
	analyticsEnabled: z.boolean().nullish(),
	defaultSiteDirectory: z.string().nullish(),
	agenticFeaturesEnabled: z.boolean().nullish(),
} );

export type UserPreferencesPatch = z.infer< typeof userPreferencesPatchSchema >;

// Which `app.json` field each patch key persists to. Also answers "does this
// patch touch app.json at all", so the lock is only taken when it must be.
const APP_CONFIG_KEYS = [
	[ 'editor', 'preferredEditor' ],
	[ 'terminal', 'preferredTerminal' ],
	[ 'colorScheme', 'colorScheme' ],
	[ 'quitSitesBehavior', 'quitSitesBehavior' ],
	[ 'defaultSiteDirectory', 'defaultSiteDirectory' ],
	[ 'agenticFeaturesEnabled', 'agenticFeaturesEnabled' ],
] as const satisfies readonly ( readonly [ keyof UserPreferencesPatch, string ] )[];

export async function readUserPreferences( {
	sitesRoot,
	installedApps,
}: UserPreferencesContext ): Promise< UserPreferences > {
	const [ config, shared ] = await Promise.all( [ readAppConfig(), readSharedConfig() ] );
	const storedEditor = editorSchema.safeParse( config.preferredEditor );

	return {
		// The desktop falls back to the first installed editor when the user has
		// never picked one; the browser has to match or the picker would read as
		// empty next to a desktop that shows a choice.
		editor: storedEditor.success ? storedEditor.data : getFirstInstalledEditor( installedApps ),
		terminal: terminalWithDefault.parse( config.preferredTerminal ),
		colorScheme: colorSchemeWithDefault.parse( config.colorScheme ),
		quitSitesBehavior: optionalQuitSitesBehavior.parse( config.quitSitesBehavior ),
		locale: shared.locale,
		analyticsEnabled: ! isAnalyticsOptedOutInConfig( shared ),
		defaultSiteDirectory: nonEmptyString.safeParse( config.defaultSiteDirectory ).data ?? sitesRoot,
		agenticFeaturesEnabled: config.agenticFeaturesEnabled !== false,
	};
}

export async function writeUserPreferences( patch: UserPreferencesPatch ): Promise< void > {
	const appEntries = APP_CONFIG_KEYS.filter( ( [ key ] ) => key in patch );

	if ( appEntries.length > 0 ) {
		await updateAppConfig( ( config ) => {
			for ( const [ patchKey, configKey ] of appEntries ) {
				const value = patch[ patchKey ];
				// Clearing re-exposes the default (the installed-editor fallback,
				// "ask every time" on quit) — same contract as the desktop's handlers.
				if ( value === null || value === undefined ) {
					delete config[ configKey ];
				} else {
					config[ configKey ] = value;
				}
			}
		} );
	}

	// One write, so a patch touching both fields takes the lockfile once.
	const sharedPatch: Partial< Parameters< typeof updateSharedConfig >[ 0 ] > = {};
	if ( patch.locale ) {
		sharedPatch.locale = patch.locale;
	}
	if ( typeof patch.analyticsEnabled === 'boolean' ) {
		sharedPatch.analyticsOptOut = ! patch.analyticsEnabled;
	}
	if ( Object.keys( sharedPatch ).length > 0 ) {
		await updateSharedConfig( sharedPatch );
	}
}

/**
 * The desktop's manual sidebar order, kept per site in `app.json`. The CLI's
 * `site list` doesn't carry it, so the browser has to read it from there too —
 * otherwise the sidebar falls back to alphabetical and disagrees with the app.
 *
 * Parsed rather than cast: the schema is lossless for the desktop-only fields
 * stored alongside `sortOrder` (site icon, theme details) but keeps malformed
 * metadata from throwing mid-write.
 */
const siteMetadataSchema = z
	.record( z.string(), z.object( { sortOrder: z.number().optional() } ).loose().catch( {} ) )
	.catch( {} );

export async function readSiteSortOrders(): Promise< Map< string, number > > {
	const siteMetadata = siteMetadataSchema.parse( ( await readAppConfig() ).siteMetadata );
	const sortOrders = new Map< string, number >();
	for ( const [ siteId, { sortOrder } ] of Object.entries( siteMetadata ) ) {
		if ( sortOrder !== undefined ) {
			sortOrders.set( siteId, sortOrder );
		}
	}
	return sortOrders;
}

export async function writeSiteSortOrders(
	updates: { siteId: string; sortOrder: number }[]
): Promise< void > {
	await updateAppConfig( ( config ) => {
		const siteMetadata = siteMetadataSchema.parse( config.siteMetadata );
		for ( const { siteId, sortOrder } of updates ) {
			siteMetadata[ siteId ] = { ...siteMetadata[ siteId ], sortOrder };
		}
		config.siteMetadata = siteMetadata;
	} );
}
