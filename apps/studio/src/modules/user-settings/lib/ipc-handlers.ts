import { IpcMainInvokeEvent, nativeTheme, shell } from 'electron';
import {
	readGlobalInstructionsFile,
	writeGlobalInstructions,
} from '@studio/agent/node/global-instructions';
import { isAgentAppId, type AgentApp } from '@studio/common/lib/agent-apps';
import { changeAiSettings } from '@studio/common/lib/ai-provider-tracks';
import {
	connectProvider,
	disconnectProvider,
	readAiSettings,
	setAiProvider as setAiProviderInConfig,
	setImageProvider as setImageProviderInConfig,
} from '@studio/common/lib/ai-settings';
import {
	connectAgentApp as connectAgentAppToStudio,
	detectAgentApps,
} from '@studio/common/lib/connect-agent-app';
import { startProviderConnect as startConnect } from '@studio/common/lib/provider-connect';
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
import { AI_PROVIDER_IDS, normalizeProviderId } from '@studio/providers';
import { getProviderServices } from '@studio/providers/services';
import { getUserLocaleWithFallback, loadLocaleData, setMacAppLanguage } from 'src/lib/locale-node';
import { refreshSpotlightIndex } from 'src/lib/spotlight';
import { recordTracksEvent, TRACKS_EVENTS } from 'src/lib/tracks';
import { defaultSitePath, getBundledNodeBinaryPath, getCliPath } from 'src/storage/paths';
import { OnboardingHintsState } from 'src/storage/storage-types';
import { loadUserData, lockAppdata, saveUserData, unlockAppdata } from 'src/storage/user-data';

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

function parseProviderId( requested: string ) {
	const provider = normalizeProviderId( requested );
	if ( ! provider ) {
		throw new Error( `Unknown AI provider: ${ requested }` );
	}
	return provider;
}

export async function startProviderConnect(
	_event: IpcMainInvokeEvent,
	requested: string,
	method: string
) {
	return startConnect( getProviderServices( parseProviderId( requested ) ), method );
}

export async function connectAiProvider(
	_event: IpcMainInvokeEvent,
	requested: string,
	method: string,
	input: Record< string, string >
) {
	const provider = parseProviderId( requested );
	return changeAiSettings(
		{ action: 'connect', provider, method },
		() => connectProvider( getProviderServices( provider ), method, input ),
		recordTracksEvent
	);
}

export async function disconnectAiProvider( _event: IpcMainInvokeEvent, requested: string ) {
	const provider = parseProviderId( requested );
	return changeAiSettings(
		{ action: 'disconnect', provider },
		() => disconnectProvider( getProviderServices( provider ) ),
		recordTracksEvent
	);
}

export async function setAiProvider( _event: IpcMainInvokeEvent, requested: string ) {
	const provider = normalizeProviderId( requested, AI_PROVIDER_IDS );
	if ( ! provider ) {
		throw new Error( `Unknown AI provider: ${ requested }` );
	}
	return changeAiSettings(
		{ action: 'select', provider },
		() => setAiProviderInConfig( provider ),
		recordTracksEvent
	);
}

export async function setImageProvider( _event: IpcMainInvokeEvent, requested: string | null ) {
	const provider = requested === null ? null : normalizeProviderId( requested, AI_PROVIDER_IDS );
	if ( provider === undefined ) {
		throw new Error( `Unknown AI provider: ${ requested }` );
	}
	return setImageProviderInConfig( provider );
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
