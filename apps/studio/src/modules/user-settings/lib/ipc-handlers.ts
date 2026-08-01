import { BrowserWindow, IpcMainInvokeEvent, nativeTheme } from 'electron';
import {
	readGlobalInstructionsFile,
	writeGlobalInstructions,
} from '@studio/common/ai/global-instructions';
import { isAnalyticsOptedOut, updateSharedConfig } from '@studio/common/lib/shared-config';
import { DEFAULT_TERMINAL } from 'src/constants';
import { sendIpcEventToRenderer, sendIpcEventToRendererWithWindow } from 'src/ipc-utils';
import { isInstalled } from 'src/lib/is-installed';
import { getUserLocaleWithFallback } from 'src/lib/locale-node';
import { recordTracksEvent, TRACKS_EVENTS, type TracksUiVersion } from 'src/lib/tracks';
import { SUPPORTED_EDITORS, SupportedEditor } from 'src/modules/user-settings/lib/editor';
import { SupportedTerminal } from 'src/modules/user-settings/lib/terminal';
import { UserSettingsTabName } from 'src/modules/user-settings/user-settings-types';
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
	await sendIpcEventToRenderer( 'user-preference-changed' );
	await updateAppdata( { preferredTerminal } );
}

export async function getUserTerminal() {
	const userData = await loadUserData();
	return userData.preferredTerminal || DEFAULT_TERMINAL;
}

export async function saveUserLocale( event: IpcMainInvokeEvent, locale: string ) {
	await updateSharedConfig( { locale } );
}

export async function saveUserEditor( event: IpcMainInvokeEvent, editor: SupportedEditor ) {
	const parentWindow = BrowserWindow.fromWebContents( event.sender );
	sendIpcEventToRendererWithWindow( parentWindow, 'user-preference-changed' );

	await updateAppdata( { preferredEditor: editor } );
}

export async function getDefaultSiteDirectory(): Promise< string > {
	const userData = await loadUserData();
	return userData.defaultSiteDirectory || defaultSitePath;
}

export async function saveDefaultSiteDirectory( event: IpcMainInvokeEvent, directory: string ) {
	await ensureWritableDirectory( directory );
	await sendIpcEventToRenderer( 'user-preference-changed' );
	await updateAppdata( { defaultSiteDirectory: directory } );
}

export async function getUserLocale() {
	return getUserLocaleWithFallback();
}

export async function getUserEditor(): Promise< SupportedEditor | null > {
	function getDefaultInstalledEditor(): SupportedEditor | null {
		const installedApps = getInstalledAppsAndTerminals();
		for ( const editor of SUPPORTED_EDITORS ) {
			if ( installedApps[ editor ] ) {
				return editor;
			}
		}
		return null;
	}
	const userData = await loadUserData();
	return userData.preferredEditor ?? getDefaultInstalledEditor();
}

export async function previewColorScheme(
	_event: IpcMainInvokeEvent,
	colorScheme: 'system' | 'light' | 'dark'
) {
	nativeTheme.themeSource = colorScheme;
}

export async function saveColorScheme(
	event: IpcMainInvokeEvent,
	colorScheme: 'system' | 'light' | 'dark'
) {
	nativeTheme.themeSource = colorScheme;
	await updateAppdata( { colorScheme } );
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

// Where the toggle was flipped — the renderer supplies both; Main can't infer them.
export interface AnalyticsToggleSource {
	surface: 'onboarding' | 'settings';
	uiVersion: TracksUiVersion;
}

export async function saveAnalyticsEnabled(
	_event: IpcMainInvokeEvent,
	enabled: boolean,
	source: AnalyticsToggleSource
): Promise< void > {
	// `recordTracksEvent` is gated by the current opt-out state, so the event must be recorded while
	// analytics is ON — before turning it off, after turning it on. Order the write around that.
	const recordEvent = () =>
		recordTracksEvent( TRACKS_EVENTS.TELEMETRY, {
			channel: 'studio-ui',
			ui_version: source.uiVersion,
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
	await updateAppdata( { quitSitesBehavior } );
}

export async function getQuitSitesBehavior(): Promise< QuitSitesBehavior | undefined > {
	const userData = await loadUserData();
	return userData.quitSitesBehavior;
}

export async function saveAgenticFeaturesEnabled(
	_event: IpcMainInvokeEvent,
	enabled: boolean
): Promise< void > {
	await updateAppdata( { agenticFeaturesEnabled: enabled } );
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

// Marks that the user reached the agentic workbench by opting in from classic
// Studio, so the orientation guide can greet them as a migrating user. Fresh
// installs get the agentic UI seeded on by default (migration 09) and never
// hit this path, so they stay "new".
export async function recordAgenticUiMigration(): Promise< void > {
	await persistOnboardingHints( { migratedFromClassic: true } );
}

export async function getGlobalAgentInstructions(): Promise< string > {
	return ( await readGlobalInstructionsFile() ) ?? '';
}

export async function saveGlobalAgentInstructions(
	_event: IpcMainInvokeEvent,
	content: string
): Promise< void > {
	await writeGlobalInstructions( content );
}

export function showUserSettings( event: IpcMainInvokeEvent, tabName?: UserSettingsTabName ) {
	const parentWindow = BrowserWindow.fromWebContents( event.sender );
	sendIpcEventToRendererWithWindow( parentWindow, 'user-settings', { tabName } );
}
