import { IpcMainInvokeEvent, nativeTheme } from 'electron';
import {
	readGlobalInstructionsFile,
	writeGlobalInstructions,
} from '@studio/common/ai/global-instructions';
import {
	readAiSettings,
	saveAnthropicApiKey as saveAnthropicApiKeyToConfig,
} from '@studio/common/ai/settings-store';
import { getInstructionsLengthBucket } from '@studio/common/lib/record-tracks-event';
import {
	detectInstalledApps,
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
import { recordTracksEvent, TRACKS_EVENTS } from 'src/lib/tracks';
import { defaultSitePath } from 'src/storage/paths';
import { OnboardingHintsState } from 'src/storage/storage-types';
import { loadUserData, lockAppdata, saveUserData, unlockAppdata } from 'src/storage/user-data';
import type { AiSettings } from '@studio/common/ai/providers';

export function getInstalledAppsAndTerminals(): InstalledApps {
	return detectInstalledApps();
}

export async function getUserPreferences() {
	return {
		...( await readUserPreferences( {
			sitesRoot: defaultSitePath,
			installedApps: detectInstalledApps(),
		} ) ),
		locale: await getUserLocaleWithFallback(),
	};
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
	}
}

export async function getDefaultSiteDirectory(): Promise< string > {
	return readDefaultSiteDirectory( defaultSitePath );
}

export async function getAgenticFeaturesEnabled(): Promise< boolean > {
	return ( await loadUserData() ).agenticFeaturesEnabled !== false;
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

// One event for both handlers: clearing the key also moves the provider back to WordPress.com.
// The key is never sent; the preview comparison only detects a key being swapped.
async function recordAiSettingsChange( previous: AiSettings, next: AiSettings ): Promise< void > {
	const unchanged =
		previous.provider === next.provider &&
		previous.hasAnthropicApiKey === next.hasAnthropicApiKey &&
		previous.anthropicApiKeyPreview === next.anthropicApiKeyPreview;
	if ( unchanged ) {
		return;
	}
	await recordTracksEvent( TRACKS_EVENTS.SETTING_AI_PROVIDER_CHANGE, {
		provider: next.provider,
		has_anthropic_api_key: next.hasAnthropicApiKey,
		surface: 'settings',
	} );
}

export async function saveAnthropicApiKey( _event: IpcMainInvokeEvent, key: string | null ) {
	const previous = await readAiSettings();
	const settings = await saveAnthropicApiKeyToConfig( key );
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
