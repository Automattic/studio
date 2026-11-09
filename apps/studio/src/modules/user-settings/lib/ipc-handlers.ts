import { IpcMainInvokeEvent, nativeTheme, shell } from 'electron';
import {
	readGlobalInstructionsFile,
	writeGlobalInstructions,
} from '@studio/agent/node/global-instructions';
import {
	getAiSettingsChange,
	readAiSettings,
	saveAiProviderApiKey as saveAiProviderApiKeyToConfig,
	setAiProvider as setAiProviderInConfig,
} from '@studio/agent/node/settings-store';
import { isAiProviderId } from '@studio/agent/protocol/providers';
import { isAgentAppId, type AgentApp } from '@studio/common/lib/agent-apps';
import {
	connectAgentApp as connectAgentAppToStudio,
	detectAgentApps,
} from '@studio/common/lib/connect-agent-app';
import { getInstructionsLengthBucket } from '@studio/common/lib/record-tracks-event';
import {
	detectInstalledAppsWithDefaultBrowser,
	type InstalledApps,
} from '@studio/common/lib/user-settings/installed-apps';
import { DEFAULT_COLOR_SCHEME } from '@studio/common/lib/user-settings/preferences';
import {
	onboardingHintsSchema,
	readDefaultSiteDirectory,
	readOnboardingHints,
	readUserPreferences,
	userPreferencesPatchSchema,
	writeOnboardingHints,
	writeUserPreferences,
	type UserPreferencesPatch,
} from '@studio/common/lib/user-settings/user-preferences';
import { getUserLocaleWithFallback, loadLocaleData, setMacAppLanguage } from 'src/lib/locale-node';
import { refreshSpotlightIndex } from 'src/lib/spotlight';
import { recordTracksEvent, TRACKS_EVENTS } from 'src/lib/tracks';
import { defaultSitePath, getBundledNodeBinaryPath, getCliPath } from 'src/storage/paths';
import { OnboardingHintsState } from 'src/storage/storage-types';
import { loadUserData, lockAppdata, saveUserData, unlockAppdata } from 'src/storage/user-data';
import type { AiSettings } from '@studio/agent/protocol/providers';

export async function getInstalledAppsAndTerminals(): Promise< InstalledApps > {
	return detectInstalledAppsWithDefaultBrowser();
}

export function getAgentApps(): Promise< AgentApp[] > {
	return detectAgentApps( { nodeBinary: getBundledNodeBinaryPath(), cliBinary: getCliPath() } );
}

export async function connectAgentApp( _event: IpcMainInvokeEvent, id: string ): Promise< void > {
	if ( ! isAgentAppId( id ) ) {
		throw new Error( `Unknown agent app: ${ id }` );
	}
	await connectAgentAppToStudio( id, {
		nodeBinary: getBundledNodeBinaryPath(),
		cliBinary: getCliPath(),
		openUrl: ( url ) => shell.openExternal( url ),
	} );
}

export async function getUserPreferences() {
	const preferences = await readUserPreferences( { sitesRoot: defaultSitePath } );
	// The scheme may have been changed from `studio ui`, so the native window follows it here.
	nativeTheme.themeSource = preferences.colorScheme;
	return { ...preferences, locale: await getUserLocaleWithFallback() };
}

export async function setUserPreferences(
	_event: IpcMainInvokeEvent,
	patch: UserPreferencesPatch
): Promise< void > {
	const parsed = userPreferencesPatchSchema.parse( patch );
	await writeUserPreferences( parsed, { sitesRoot: defaultSitePath, recordTracksEvent } );
	if ( parsed.colorScheme !== undefined ) {
		nativeTheme.themeSource = parsed.colorScheme ?? DEFAULT_COLOR_SCHEME;
	}
	if ( parsed.locale ) {
		loadLocaleData( parsed.locale );
		setMacAppLanguage( parsed.locale );
		void refreshSpotlightIndex();
	}
}

export async function getDefaultSiteDirectory(): Promise< string > {
	return readDefaultSiteDirectory( defaultSitePath );
}

export async function saveWapuuScore( _event: IpcMainInvokeEvent, score: number ): Promise< void > {
	if ( ! Number.isFinite( score ) || score < 0 || score > 100_000 ) {
		return;
	}
	const intScore = Math.floor( score );
	await lockAppdata();
	try {
		const userData = await loadUserData();
		if ( userData.wapuuScore === undefined || intScore > userData.wapuuScore ) {
			await saveUserData( { ...userData, wapuuScore: intScore } );
		}
	} finally {
		await unlockAppdata();
	}
}

export async function getWapuuScore(): Promise< number | undefined > {
	const userData = await loadUserData();
	return userData.wapuuScore;
}

// Agentic UI onboarding state (orientation guide seen-state, migration marker).
export async function getOnboardingHints(): Promise< OnboardingHintsState > {
	return readOnboardingHints();
}

export async function saveOnboardingHints(
	_event: IpcMainInvokeEvent,
	partial: Partial< OnboardingHintsState >
): Promise< void > {
	await writeOnboardingHints( onboardingHintsSchema.parse( partial ) );
}

// Marks a user who came from classic Studio (migration 09), so the orientation
// guide can greet them as a migrating user. Fresh installs stay "new".
export async function recordAgenticUiMigration(): Promise< void > {
	await writeOnboardingHints( { migratedFromClassic: true } );
}

export async function getGlobalAgentInstructions(): Promise< string > {
	return ( await readGlobalInstructionsFile() ) ?? '';
}

export async function getAiSettings() {
	return readAiSettings();
}

async function recordAiSettingsChange( previous: AiSettings, next: AiSettings ): Promise< void > {
	const change = getAiSettingsChange( previous, next );
	if ( change ) {
		await recordTracksEvent( TRACKS_EVENTS.SETTING_AI_PROVIDER_CHANGE, change );
	}
}

export async function saveAiProviderApiKey(
	_event: IpcMainInvokeEvent,
	provider: string,
	key: string | null
) {
	if ( ! isAiProviderId( provider ) ) {
		throw new Error( `Unknown AI provider: ${ provider }` );
	}
	if ( key !== null && typeof key !== 'string' ) {
		throw new Error( 'API key must be a string or null' );
	}
	const previous = await readAiSettings();
	const settings = await saveAiProviderApiKeyToConfig( provider, key );
	await recordAiSettingsChange( previous, settings );
	return settings;
}

export async function setAiProvider( _event: IpcMainInvokeEvent, provider: string ) {
	if ( ! isAiProviderId( provider ) ) {
		throw new Error( `Unknown AI provider: ${ provider }` );
	}
	const previous = await readAiSettings();
	const settings = await setAiProviderInConfig( provider );
	await recordAiSettingsChange( previous, settings );
	return settings;
}

export async function saveGlobalAgentInstructions(
	_event: IpcMainInvokeEvent,
	content: string,
	// Set when this save ends an edit session. Only the renderer knows the value it started from,
	// since the agentic UI autosaves on a debounce. Intermediate autosaves omit it.
	options: { editSession?: { previousContent: string } } = {}
): Promise< void > {
	await writeGlobalInstructions( content );

	const previous = options.editSession?.previousContent;
	if ( previous === undefined || previous === content ) {
		return;
	}
	await recordTracksEvent( TRACKS_EVENTS.SETTING_INSTRUCTIONS_CHANGE, {
		has_content: content.trim().length > 0,
		length_bucket: getInstructionsLengthBucket( content ),
		surface: 'settings',
	} );
}
