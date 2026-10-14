import { readAppConfig, updateAppConfig, type AppConfig } from '@studio/common/lib/app-config';
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
 * Preferences for `studio ui`, read from the files the desktop also uses:
 * `app.json` for the UI preferences, `shared.json` for locale and the analytics
 * opt-out. Defaults mirror the desktop's user-settings handlers, so a
 * preference the user never touched reads the same on either side.
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

// Passed in, so this stays a pure reader over the config files.
export interface UserPreferencesContext {
	sitesRoot: string;
	installedApps: InstalledApps;
}

const editorSchema = z.enum( SUPPORTED_EDITORS );
const terminalWithDefault = z.enum( SUPPORTED_TERMINALS ).catch( DEFAULT_TERMINAL );
const colorSchemeWithDefault = z.enum( SUPPORTED_COLOR_SCHEMES ).catch( DEFAULT_COLOR_SCHEME );
const optionalQuitSitesBehavior = z.enum( QUIT_SITES_BEHAVIORS ).optional().catch( undefined );
const nonEmptyString = z.string().nonempty();

// `null` clears a preference back to its default; JSON drops `undefined` keys,
// so a clear can't travel as one.
export const userPreferencesPatchSchema = z.object( {
	editor: editorSchema.nullish(),
	terminal: z.enum( SUPPORTED_TERMINALS ).nullish(),
	colorScheme: z.enum( SUPPORTED_COLOR_SCHEMES ).nullish(),
	quitSitesBehavior: z.enum( QUIT_SITES_BEHAVIORS ).nullish(),
	// Rejected at the route rather than dropped after a 204.
	locale: z.string().refine( isSupportedLocale ).nullish(),
	analyticsEnabled: z.boolean().nullish(),
	defaultSiteDirectory: z.string().nullish(),
	agenticFeaturesEnabled: z.boolean().nullish(),
} );

export type UserPreferencesPatch = z.infer< typeof userPreferencesPatchSchema >;

// Patch key -> `app.json` field. Also answers whether the lock is needed.
const APP_CONFIG_KEYS = [
	[ 'editor', 'preferredEditor' ],
	[ 'terminal', 'preferredTerminal' ],
	[ 'colorScheme', 'colorScheme' ],
	[ 'quitSitesBehavior', 'quitSitesBehavior' ],
	[ 'defaultSiteDirectory', 'defaultSiteDirectory' ],
	[ 'agenticFeaturesEnabled', 'agenticFeaturesEnabled' ],
] as const satisfies readonly ( readonly [ keyof UserPreferencesPatch, string ] )[];

function getDefaultSiteDirectory( config: AppConfig, sitesRoot: string ): string {
	return nonEmptyString.safeParse( config.defaultSiteDirectory ).data ?? sitesRoot;
}

// Where new and duplicated sites go: the desktop's preference, else the sites root.
export async function readDefaultSiteDirectory( sitesRoot: string ): Promise< string > {
	return getDefaultSiteDirectory( await readAppConfig(), sitesRoot );
}

export async function readUserPreferences( {
	sitesRoot,
	installedApps,
}: UserPreferencesContext ): Promise< UserPreferences > {
	const [ config, shared ] = await Promise.all( [ readAppConfig(), readSharedConfig() ] );
	const storedEditor = editorSchema.safeParse( config.preferredEditor );

	return {
		// Unset falls back to the first installed editor, as the desktop does.
		editor: storedEditor.success ? storedEditor.data : getFirstInstalledEditor( installedApps ),
		terminal: terminalWithDefault.parse( config.preferredTerminal ),
		colorScheme: colorSchemeWithDefault.parse( config.colorScheme ),
		quitSitesBehavior: optionalQuitSitesBehavior.parse( config.quitSitesBehavior ),
		locale: shared.locale,
		analyticsEnabled: ! isAnalyticsOptedOutInConfig( shared ),
		defaultSiteDirectory: getDefaultSiteDirectory( config, sitesRoot ),
		agenticFeaturesEnabled: config.agenticFeaturesEnabled !== false,
	};
}

export async function writeUserPreferences( patch: UserPreferencesPatch ): Promise< void > {
	const appEntries = APP_CONFIG_KEYS.filter( ( [ key ] ) => key in patch );

	if ( appEntries.length > 0 ) {
		await updateAppConfig( ( config ) => {
			for ( const [ patchKey, configKey ] of appEntries ) {
				const value = patch[ patchKey ];
				if ( value === null || value === undefined ) {
					delete config[ configKey ];
				} else {
					config[ configKey ] = value;
				}
			}
		} );
	}

	// Accumulated so a patch touching both fields takes the lockfile once.
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

// The orientation guide's progress, kept in `app.json` like the desktop does so
// finishing the tour in either front end settles both. `.loose()` keeps any
// field a newer desktop adds.
export const onboardingHintsSchema = z
	.object( {
		tourCompletedVersion: z.number().optional(),
		tourDismissedVersion: z.number().optional(),
		migratedFromClassic: z.boolean().optional(),
	} )
	.loose();

type OnboardingHints = z.infer< typeof onboardingHintsSchema >;

export async function readOnboardingHints(): Promise< OnboardingHints > {
	return onboardingHintsSchema.catch( {} ).parse( ( await readAppConfig() ).onboardingHints );
}

export async function writeOnboardingHints( patch: OnboardingHints ): Promise< void > {
	await updateAppConfig( ( config ) => {
		config.onboardingHints = {
			...onboardingHintsSchema.catch( {} ).parse( config.onboardingHints ),
			...patch,
		};
	} );
}
