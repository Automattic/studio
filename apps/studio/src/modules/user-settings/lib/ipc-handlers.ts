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
	listProviderModels,
	selectProviderModels,
	readAiSettings,
	setAiProvider as setAiProviderInConfig,
	setImageProvider as setImageProviderInConfig,
} from '@studio/common/lib/ai-settings';
import { updateConfig } from '@studio/common/lib/config/store';
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
	type OnboardingHints,
	readDefaultSiteDirectory,
	readOnboardingHints,
	readUserPreferences,
	userPreferencesPatchSchema,
	writeOnboardingHints,
	writeUserPreferences,
	type UserPreferencesPatch,
} from '@studio/common/lib/user-settings/user-preferences';
import { AI_PROVIDER_IDS, normalizeProviderId, type CatalogModel } from '@studio/providers';
import { getProviderServices } from '@studio/providers/services';
import { getUserLocaleWithFallback, loadLocaleData, setMacAppLanguage } from 'src/lib/locale-node';
import { refreshSpotlightIndex } from 'src/lib/spotlight';
import { recordTracksEvent, TRACKS_EVENTS } from 'src/lib/tracks';
import { readDesktopState } from 'src/storage/desktop-state';
import { defaultSitePath, getBundledNodeBinaryPath, getCliPath } from 'src/storage/paths';

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
	await updateConfig( ( { desktop } ) => {
		if ( desktop.wapuuScore === undefined || intScore > desktop.wapuuScore ) {
			desktop.wapuuScore = intScore;
		}
	} );
}

export async function getWapuuScore(): Promise< number | undefined > {
	return ( await readDesktopState() ).wapuuScore;
}

// Agentic UI onboarding state (orientation guide seen-state, migration marker).
export async function getOnboardingHints(): Promise< OnboardingHints > {
	return readOnboardingHints();
}

export async function saveOnboardingHints(
	_event: IpcMainInvokeEvent,
	partial: Partial< OnboardingHints >
): Promise< void > {
	await writeOnboardingHints( onboardingHintsSchema.parse( partial ) );
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

export async function listAiProviderModels( _event: IpcMainInvokeEvent, requested: string ) {
	return listProviderModels( getProviderServices( parseProviderId( requested ) ) );
}

export async function selectAiProviderModels(
	_event: IpcMainInvokeEvent,
	requested: string,
	models: CatalogModel[]
) {
	return selectProviderModels( getProviderServices( parseProviderId( requested ) ), models );
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
