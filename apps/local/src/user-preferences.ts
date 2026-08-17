import { readAppConfig, updateAppConfig } from '@studio/common/lib/app-config';
import { isSupportedLocale } from '@studio/common/lib/locale';
import { readSharedConfig, updateSharedConfig } from '@studio/common/lib/shared-config';
import { SUPPORTED_EDITORS } from '@studio/common/lib/user-settings/editor';
import {
	detectInstalledApps,
	getFirstInstalledEditor,
} from '@studio/common/lib/user-settings/installed-apps';
import { DEFAULT_TERMINAL, SUPPORTED_TERMINALS } from '@studio/common/lib/user-settings/terminal';
import { z } from 'zod';
import type { AppConfig } from '@studio/common/lib/app-config';
import type { SharedConfig } from '@studio/common/lib/shared-config';
import type { SupportedEditor } from '@studio/common/lib/user-settings/editor';
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

const editorSchema = z.enum( SUPPORTED_EDITORS );
const terminalSchema = z.enum( SUPPORTED_TERMINALS );
const colorSchemeSchema = z.enum( [ 'system', 'light', 'dark' ] );
const quitSitesBehaviorSchema = z.enum( [ 'stop', 'stop-and-auto-start', 'leave-running' ] );

export type ColorScheme = z.infer< typeof colorSchemeSchema >;
export type QuitSitesBehavior = z.infer< typeof quitSitesBehaviorSchema >;

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

// `null` clears a preference. JSON drops `undefined` keys, so an explicit clear
// (no preferred editor, "ask every time" on quit) has to travel as null.
export const userPreferencesPatchSchema = z.object( {
	editor: editorSchema.nullish(),
	terminal: terminalSchema.nullish(),
	colorScheme: colorSchemeSchema.nullish(),
	quitSitesBehavior: quitSitesBehaviorSchema.nullish(),
	locale: z.string().nullish(),
	analyticsEnabled: z.boolean().nullish(),
	defaultSiteDirectory: z.string().nullish(),
	agenticFeaturesEnabled: z.boolean().nullish(),
} );

export type UserPreferencesPatch = z.infer< typeof userPreferencesPatchSchema >;

// Which `app.json` field each patch key persists to. Also answers "does this
// patch touch app.json at all", so the lock is only taken when it must be.
const APP_CONFIG_KEYS = {
	editor: 'preferredEditor',
	terminal: 'preferredTerminal',
	colorScheme: 'colorScheme',
	quitSitesBehavior: 'quitSitesBehavior',
	defaultSiteDirectory: 'defaultSiteDirectory',
	agenticFeaturesEnabled: 'agenticFeaturesEnabled',
} as const;

// The desktop falls back to the first installed editor when the user has never
// picked one, so the browser has to resolve it the same way or the picker would
// read as empty next to a desktop that shows a choice.
function readEditor( config: AppConfig ): SupportedEditor | null {
	const stored = editorSchema.safeParse( config.preferredEditor );
	return stored.success ? stored.data : getFirstInstalledEditor( detectInstalledApps() );
}

export async function getPreferredEditor(): Promise< SupportedEditor | null > {
	return readEditor( await readAppConfig() );
}

export async function getPreferredTerminal(): Promise< SupportedTerminal > {
	const config = await readAppConfig();
	return terminalSchema.catch( DEFAULT_TERMINAL ).parse( config.preferredTerminal );
}

/**
 * @param sitesRoot Where the server creates sites, used as the
 * default-site-directory fallback (the desktop's `defaultSitePath`).
 */
export async function readUserPreferences( sitesRoot: string ): Promise< UserPreferences > {
	const [ config, shared ] = await Promise.all( [ readAppConfig(), readSharedConfig() ] );
	const defaultSiteDirectory = z.string().nonempty().catch( sitesRoot );

	return {
		editor: readEditor( config ),
		terminal: terminalSchema.catch( DEFAULT_TERMINAL ).parse( config.preferredTerminal ),
		colorScheme: colorSchemeSchema.catch( 'light' ).parse( config.colorScheme ),
		quitSitesBehavior: quitSitesBehaviorSchema
			.optional()
			.catch( undefined )
			.parse( config.quitSitesBehavior ),
		locale: shared.locale,
		// Absent means opted in — see `docs/design-docs/analytics-tracks.md`.
		analyticsEnabled: shared.analyticsOptOut !== true,
		defaultSiteDirectory: defaultSiteDirectory.parse( config.defaultSiteDirectory ),
		agenticFeaturesEnabled: config.agenticFeaturesEnabled !== false,
	};
}

export async function writeUserPreferences( patch: UserPreferencesPatch ): Promise< void > {
	const appEntries = Object.entries( APP_CONFIG_KEYS ).filter( ( [ key ] ) => key in patch ) as [
		keyof typeof APP_CONFIG_KEYS,
		string,
	][];

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
	const sharedPatch: Partial< SharedConfig > = {};
	const locale = patch.locale ?? undefined;
	if ( isSupportedLocale( locale ) ) {
		sharedPatch.locale = locale;
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
 */
const siteMetadataSchema = z
	.record( z.string(), z.object( { sortOrder: z.number().optional() } ).loose().catch( {} ) )
	.catch( {} );

export async function readSiteSortOrders(): Promise< Map< string, number > > {
	const siteMetadata = siteMetadataSchema.parse( ( await readAppConfig() ).siteMetadata );
	return new Map(
		Object.entries( siteMetadata ).flatMap( ( [ siteId, { sortOrder } ] ) =>
			sortOrder === undefined ? [] : [ [ siteId, sortOrder ] as [ string, number ] ]
		)
	);
}

export async function writeSiteSortOrders(
	updates: { siteId: string; sortOrder: number }[]
): Promise< void > {
	await updateAppConfig( ( config ) => {
		// Parsed, not cast: the schema is lossless for the desktop-only fields
		// alongside `sortOrder` (site icon, theme details) but keeps a malformed
		// `siteMetadata` from throwing mid-write.
		const siteMetadata = siteMetadataSchema.parse( config.siteMetadata );
		for ( const { siteId, sortOrder } of updates ) {
			siteMetadata[ siteId ] = { ...siteMetadata[ siteId ], sortOrder };
		}
		config.siteMetadata = siteMetadata;
	} );
}
