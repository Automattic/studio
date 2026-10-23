import fs from 'node:fs/promises';
import { z } from 'zod';
import { readAppConfig, updateAppConfig, type AppConfig } from '@studio/common/lib/app-config';
import { isSupportedLocale } from '@studio/common/lib/locale';
import { TRACKS_EVENTS } from '@studio/common/lib/record-tracks-event';
import {
	isAnalyticsOptedOutInConfig,
	readSharedConfig,
	updateSharedConfig,
} from '@studio/common/lib/shared-config';
import { SUPPORTED_EDITORS } from '@studio/common/lib/user-settings/editor';
import {
	DEFAULT_COLOR_SCHEME,
	INTERFACE_PREFERENCE_DEFAULTS,
	NEW_SITE_BEHAVIORS,
	QUIT_SITES_BEHAVIORS,
	SUPPORTED_COLOR_SCHEMES,
} from '@studio/common/lib/user-settings/preferences';
import { DEFAULT_TERMINAL, SUPPORTED_TERMINALS } from '@studio/common/lib/user-settings/terminal';
import type { TracksEventName, TracksProps } from '@studio/common/lib/record-tracks-event';
import type { SupportedEditor } from '@studio/common/lib/user-settings/editor';
import type {
	ColorScheme,
	NewSiteBehavior,
	QuitSitesBehavior,
} from '@studio/common/lib/user-settings/preferences';
import type { SupportedTerminal } from '@studio/common/lib/user-settings/terminal';

/**
 * The user's preferences, read and written by both Studio apps: `app.json` for
 * the UI preferences, `shared.json` for locale and the analytics opt-out.
 */

export interface UserPreferences {
	// `null` is the default: the first installed editor, the system terminal.
	editor: SupportedEditor | null;
	terminal: SupportedTerminal | null;
	colorScheme: ColorScheme;
	quitSitesBehavior?: QuitSitesBehavior;
	locale: string | undefined;
	analyticsEnabled: boolean;
	defaultSiteDirectory: string;
	agenticFeaturesEnabled: boolean;
	// The sidebar's Pinned group, in order, as `site:<id>` and `chat:<id>` keys.
	sidebarPins: string[];
	// Each site's chats in the order the user dragged them into, by site id.
	sidebarChatOrder: Record< string, string[] >;
	showRecentChats: boolean;
	// Opening a site's chats in the sidebar folds the others.
	autoCollapseSites: boolean;
	// Start a stopped local site when a chat message is sent to it.
	autoStartSiteOnChat: boolean;
	// Ask before discarding preview annotations.
	confirmDeleteAnnotations: boolean;
	newSiteBehavior: NewSiteBehavior;
}

// Passed in, so this stays a pure reader over the config files.
export interface UserPreferencesContext {
	// Where new sites go unless the user picked another directory.
	sitesRoot: string;
}

export interface UserPreferencesWriteContext {
	sitesRoot: string;
	recordTracksEvent?: ( event: TracksEventName, props: TracksProps ) => Promise< void >;
}

const editorSchema = z.enum( SUPPORTED_EDITORS );
const terminalWithDefault = z.enum( SUPPORTED_TERMINALS ).catch( DEFAULT_TERMINAL );
const optionalEditor = editorSchema.nullable().catch( null );
const optionalTerminal = z.enum( SUPPORTED_TERMINALS ).nullable().catch( null );
const colorSchemeWithDefault = z.enum( SUPPORTED_COLOR_SCHEMES ).catch( DEFAULT_COLOR_SCHEME );
const optionalQuitSitesBehavior = z.enum( QUIT_SITES_BEHAVIORS ).optional().catch( undefined );
const nonEmptyString = z.string().nonempty();
const sidebarPinsSchema = z.array( z.string() );
const sidebarChatOrderSchema = z.record( z.string(), z.array( z.string() ) );

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
	sidebarPins: sidebarPinsSchema.nullish(),
	sidebarChatOrder: sidebarChatOrderSchema.nullish(),
	showRecentChats: z.boolean().nullish(),
	autoCollapseSites: z.boolean().nullish(),
	autoStartSiteOnChat: z.boolean().nullish(),
	confirmDeleteAnnotations: z.boolean().nullish(),
	newSiteBehavior: z.enum( NEW_SITE_BEHAVIORS ).nullish(),
	// Where the change was made (the analytics toggle also appears during onboarding); not stored.
	surface: z.enum( [ 'onboarding', 'settings' ] ).optional(),
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
	[ 'sidebarPins', 'sidebarPins' ],
	[ 'sidebarChatOrder', 'sidebarChatOrder' ],
	[ 'showRecentChats', 'showRecentChats' ],
	[ 'autoCollapseSites', 'autoCollapseSites' ],
	[ 'autoStartSiteOnChat', 'autoStartSiteOnChat' ],
	[ 'confirmDeleteAnnotations', 'confirmDeleteAnnotations' ],
	[ 'newSiteBehavior', 'newSiteBehavior' ],
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
}: UserPreferencesContext ): Promise< UserPreferences > {
	const [ config, shared ] = await Promise.all( [ readAppConfig(), readSharedConfig() ] );
	const {
		autoStartSiteOnChat,
		confirmDeleteAnnotations,
		showRecentChats,
		autoCollapseSites,
		newSiteBehavior,
	} = INTERFACE_PREFERENCE_DEFAULTS;

	return {
		editor: optionalEditor.parse( config.preferredEditor ?? null ),
		terminal: optionalTerminal.parse( config.preferredTerminal ?? null ),
		colorScheme: colorSchemeWithDefault.parse( config.colorScheme ),
		quitSitesBehavior: optionalQuitSitesBehavior.parse( config.quitSitesBehavior ),
		locale: shared.locale,
		analyticsEnabled: ! isAnalyticsOptedOutInConfig( shared ),
		defaultSiteDirectory: getDefaultSiteDirectory( config, sitesRoot ),
		agenticFeaturesEnabled: config.agenticFeaturesEnabled !== false,
		sidebarPins: sidebarPinsSchema.catch( [] ).parse( config.sidebarPins ),
		sidebarChatOrder: sidebarChatOrderSchema.catch( {} ).parse( config.sidebarChatOrder ?? {} ),
		showRecentChats: z.boolean().catch( showRecentChats ).parse( config.showRecentChats ),
		autoCollapseSites: z.boolean().catch( autoCollapseSites ).parse( config.autoCollapseSites ),
		autoStartSiteOnChat: z
			.boolean()
			.catch( autoStartSiteOnChat )
			.parse( config.autoStartSiteOnChat ),
		confirmDeleteAnnotations: z
			.boolean()
			.catch( confirmDeleteAnnotations )
			.parse( config.confirmDeleteAnnotations ),
		newSiteBehavior: z
			.enum( NEW_SITE_BEHAVIORS )
			.catch( newSiteBehavior )
			.parse( config.newSiteBehavior ),
	};
}

async function ensureWritableDirectory( directory: string ): Promise< void > {
	if ( ! ( await fs.stat( directory ) ).isDirectory() ) {
		throw new Error( 'Selected path is not a directory.' );
	}
	await fs.access( directory, fs.constants.W_OK );
}

// One event per preference the patch changes; never the directory path itself.
async function getChangeEvents(
	patch: UserPreferencesPatch,
	sitesRoot: string
): Promise< Array< [ TracksEventName, TracksProps ] > > {
	const surface = patch.surface ?? 'settings';
	const [ config, shared ] = await Promise.all( [ readAppConfig(), readSharedConfig() ] );
	const events: Array< [ TracksEventName, TracksProps ] > = [];
	const { colorScheme, locale, editor, terminal, defaultSiteDirectory, quitSitesBehavior } = patch;

	if ( colorScheme && colorScheme !== colorSchemeWithDefault.parse( config.colorScheme ) ) {
		events.push( [ TRACKS_EVENTS.SETTING_APPEARANCE_CHANGE, { mode: colorScheme, surface } ] );
	}
	if ( locale && locale !== shared.locale ) {
		events.push( [ TRACKS_EVENTS.SETTING_LANGUAGE_CHANGE, { locale, surface } ] );
	}
	if ( editor && editor !== config.preferredEditor ) {
		events.push( [ TRACKS_EVENTS.SETTING_CODE_EDITOR_CHANGE, { editor, surface } ] );
	}
	if ( terminal && terminal !== terminalWithDefault.parse( config.preferredTerminal ) ) {
		events.push( [ TRACKS_EVENTS.SETTING_TERMINAL_CHANGE, { terminal, surface } ] );
	}
	if (
		defaultSiteDirectory &&
		defaultSiteDirectory !== getDefaultSiteDirectory( config, sitesRoot )
	) {
		events.push( [
			TRACKS_EVENTS.SETTING_DEFAULT_DIRECTORY_CHANGE,
			{ is_default: defaultSiteDirectory === sitesRoot, surface },
		] );
	}
	if ( quitSitesBehavior && quitSitesBehavior !== config.quitSitesBehavior ) {
		events.push( [
			TRACKS_EVENTS.SETTING_QUIT_ACTION_CHANGE,
			{ behavior: quitSitesBehavior, surface },
		] );
	}
	if (
		typeof patch.agenticFeaturesEnabled === 'boolean' &&
		patch.agenticFeaturesEnabled !== ( config.agenticFeaturesEnabled !== false )
	) {
		events.push( [
			TRACKS_EVENTS.SETTING_AGENTIC_FEATURES_CHANGE,
			{ enabled: patch.agenticFeaturesEnabled, surface },
		] );
	}
	if ( typeof patch.analyticsEnabled === 'boolean' ) {
		events.push( [
			TRACKS_EVENTS.SETTING_TELEMETRY_CHANGE,
			{ status: patch.analyticsEnabled ? 'on' : 'off', surface },
		] );
	}
	return events;
}

export async function writeUserPreferences(
	patch: UserPreferencesPatch,
	context: UserPreferencesWriteContext
): Promise< void > {
	if ( patch.defaultSiteDirectory ) {
		await ensureWritableDirectory( patch.defaultSiteDirectory );
	}
	const { recordTracksEvent } = context;
	const events = recordTracksEvent ? await getChangeEvents( patch, context.sitesRoot ) : [];
	// Tracks drops events while analytics is off, so they go out before opting out and after opting in.
	const record = () =>
		Promise.all( events.map( ( [ event, props ] ) => recordTracksEvent?.( event, props ) ) );
	if ( patch.analyticsEnabled === false ) {
		await record();
	}

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

	if ( patch.analyticsEnabled !== false ) {
		await record();
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
