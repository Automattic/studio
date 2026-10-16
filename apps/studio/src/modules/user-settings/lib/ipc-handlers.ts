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
	isAnalyticsOptedOut,
	readSharedConfig,
	updateSharedConfig,
} from '@studio/common/lib/shared-config';
import { SupportedEditor } from '@studio/common/lib/user-settings/editor';
import {
	getFirstInstalledEditor,
	isInstalled,
} from '@studio/common/lib/user-settings/installed-apps';
import { SupportedTerminal } from '@studio/common/lib/user-settings/terminal';
import { DEFAULT_TERMINAL } from 'src/constants';
import { getUserLocaleWithFallback, loadLocaleData, setMacAppLanguage } from 'src/lib/locale-node';
import { recordTracksEvent, TRACKS_EVENTS } from 'src/lib/tracks';
import { defaultSitePath, ensureWritableDirectory } from 'src/storage/paths';
import { OnboardingHintsState } from 'src/storage/storage-types';
import {
	loadUserData,
	lockAppdata,
	saveUserData,
	type QuitSitesBehavior,
	unlockAppdata,
	updateAppdata,
} from 'src/storage/user-data';
import type { AiSettings } from '@studio/common/ai/providers';

export function getInstalledAppsAndTerminals(): InstalledApps {
	return {
		antigravity: isInstalled( 'antigravity' ),
		vscode: isInstalled( 'vscode' ),
		phpstorm: isInstalled( 'phpstorm' ),
		webstorm: isInstalled( 'webstorm' ),
		windsurf: isInstalled( 'windsurf' ),
		cursor: isInstalled( 'cursor' ),
		sublime: isInstalled( 'sublime' ),
		zed: isInstalled( 'zed' ),
		terminal: true, // Terminal.app is always available on macOS
		iterm: isInstalled( 'iterm' ),
		warp: isInstalled( 'warp' ),
		ghostty: isInstalled( 'ghostty' ),
	};
}

export async function saveUserTerminal(
	event: IpcMainInvokeEvent,
	preferredTerminal: SupportedTerminal
) {
	const previous = ( await loadUserData() ).preferredTerminal || DEFAULT_TERMINAL;
	await updateAppdata( { preferredTerminal } );
	if ( preferredTerminal !== previous ) {
		await recordTracksEvent( TRACKS_EVENTS.SETTING_TERMINAL_CHANGE, {
			terminal: preferredTerminal,
			surface: 'settings',
		} );
	}
}

export async function getUserTerminal() {
	const userData = await loadUserData();
	return userData.preferredTerminal || DEFAULT_TERMINAL;
}

export async function saveUserLocale( event: IpcMainInvokeEvent, locale: string ) {
	const previous = ( await readSharedConfig() ).locale;
	await updateSharedConfig( { locale } );
	loadLocaleData( locale );
	setMacAppLanguage( locale );
	if ( locale !== previous ) {
		await recordTracksEvent( TRACKS_EVENTS.SETTING_LANGUAGE_CHANGE, {
			locale,
			surface: 'settings',
		} );
	}
}

export async function saveUserEditor( event: IpcMainInvokeEvent, editor: SupportedEditor ) {
	const previous = ( await loadUserData() ).preferredEditor;
	await updateAppdata( { preferredEditor: editor } );
	if ( editor !== previous ) {
		await recordTracksEvent( TRACKS_EVENTS.SETTING_CODE_EDITOR_CHANGE, {
			editor,
			surface: 'settings',
		} );
	}
}

export async function getDefaultSiteDirectory(): Promise< string > {
	const userData = await loadUserData();
	return userData.defaultSiteDirectory || defaultSitePath;
}

export async function saveDefaultSiteDirectory( event: IpcMainInvokeEvent, directory: string ) {
	await ensureWritableDirectory( directory );
	const previous = ( await loadUserData() ).defaultSiteDirectory || defaultSitePath;
	await updateAppdata( { defaultSiteDirectory: directory } );
	if ( directory !== previous ) {
		await recordTracksEvent( TRACKS_EVENTS.SETTING_DEFAULT_DIRECTORY_CHANGE, {
			is_default: directory === defaultSitePath,
			surface: 'settings',
		} );
	}
}

export async function getUserLocale() {
	return getUserLocaleWithFallback();
}

export async function getUserEditor(): Promise< SupportedEditor | null > {
	const userData = await loadUserData();
	return userData.preferredEditor ?? getFirstInstalledEditor( getInstalledAppsAndTerminals() );
}

export async function saveColorScheme(
	event: IpcMainInvokeEvent,
	colorScheme: 'system' | 'light' | 'dark'
) {
	const previous = ( await loadUserData() ).colorScheme ?? 'light';
	nativeTheme.themeSource = colorScheme;
	await updateAppdata( { colorScheme } );
	if ( colorScheme !== previous ) {
		await recordTracksEvent( TRACKS_EVENTS.SETTING_APPEARANCE_CHANGE, {
			mode: colorScheme,
			surface: 'settings',
		} );
	}
}

export async function getColorScheme(): Promise< 'system' | 'light' | 'dark' > {
	const userData = await loadUserData();
	const colorScheme = userData.colorScheme ?? 'light';
	nativeTheme.themeSource = colorScheme;
	return colorScheme;
}

// Analytics opt-out. Stored in shared.json so both Studio and the Studio CLI honor it. Default is
// opted IN (analytics ON). See `docs/design-docs/analytics-tracks.md`.
export async function getAnalyticsEnabled(): Promise< boolean > {
	return ! ( await isAnalyticsOptedOut() );
}

// Where the toggle was flipped — the renderer supplies the surface; Main can't infer it.
export interface AnalyticsToggleSource {
	surface: 'onboarding' | 'settings';
}

export async function saveAnalyticsEnabled(
	_event: IpcMainInvokeEvent,
	enabled: boolean,
	source: AnalyticsToggleSource
): Promise< void > {
	// `recordTracksEvent` is gated by the current opt-out state, so the event must be recorded while
	// analytics is ON — before turning it off, after turning it on. Order the write around that.
	const recordEvent = () =>
		recordTracksEvent( TRACKS_EVENTS.SETTING_TELEMETRY_CHANGE, {
			surface: source.surface,
			status: enabled ? 'on' : 'off',
		} );

	if ( enabled ) {
		await updateSharedConfig( { analyticsOptOut: false } );
		await recordEvent();
	} else {
		await recordEvent();
		await updateSharedConfig( { analyticsOptOut: true } );
	}
}

export async function saveQuitSitesBehavior(
	_event: IpcMainInvokeEvent,
	quitSitesBehavior: QuitSitesBehavior | undefined
) {
	const previous = ( await loadUserData() ).quitSitesBehavior;
	await updateAppdata( { quitSitesBehavior } );
	if ( quitSitesBehavior && quitSitesBehavior !== previous ) {
		await recordTracksEvent( TRACKS_EVENTS.SETTING_QUIT_ACTION_CHANGE, {
			behavior: quitSitesBehavior,
			surface: 'settings',
		} );
	}
}

export async function getQuitSitesBehavior(): Promise< QuitSitesBehavior | undefined > {
	const userData = await loadUserData();
	return userData.quitSitesBehavior;
}

export async function saveAgenticFeaturesEnabled(
	_event: IpcMainInvokeEvent,
	enabled: boolean
): Promise< void > {
	const previous = ( await loadUserData() ).agenticFeaturesEnabled ?? true;
	await updateAppdata( { agenticFeaturesEnabled: enabled } );
	if ( enabled !== previous ) {
		await recordTracksEvent( TRACKS_EVENTS.SETTING_AGENTIC_FEATURES_CHANGE, {
			enabled,
			surface: 'settings',
		} );
	}
}

export async function getAgenticFeaturesEnabled(): Promise< boolean > {
	const userData = await loadUserData();
	return userData.agenticFeaturesEnabled ?? true;
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
// The blob is opaque to the desktop; the renderer owns its meaning.
export async function getOnboardingHints(): Promise< OnboardingHintsState > {
	const userData = await loadUserData();
	return userData.onboardingHints ?? {};
}

async function persistOnboardingHints( partial: Partial< OnboardingHintsState > ): Promise< void > {
	if ( ! partial || typeof partial !== 'object' ) {
		return;
	}
	await lockAppdata();
	try {
		const userData = await loadUserData();
		const merged: OnboardingHintsState = { ...( userData.onboardingHints ?? {} ), ...partial };
		await saveUserData( { ...userData, onboardingHints: merged } );
	} finally {
		await unlockAppdata();
	}
}

export async function saveOnboardingHints(
	_event: IpcMainInvokeEvent,
	partial: Partial< OnboardingHintsState >
): Promise< void > {
	await persistOnboardingHints( partial );
}

// Marks a user who came from classic Studio (migration 09), so the orientation
// guide can greet them as a migrating user. Fresh installs stay "new".
export async function recordAgenticUiMigration(): Promise< void > {
	await persistOnboardingHints( { migratedFromClassic: true } );
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
