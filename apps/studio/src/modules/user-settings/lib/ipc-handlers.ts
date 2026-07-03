import { BrowserWindow, IpcMainInvokeEvent, nativeTheme } from 'electron';
import { updateSharedConfig } from '@studio/common/lib/shared-config';
import { DEFAULT_TERMINAL } from 'src/constants';
import { sendIpcEventToRenderer, sendIpcEventToRendererWithWindow } from 'src/ipc-utils';
import { isInstalled } from 'src/lib/is-installed';
import { getUserLocaleWithFallback } from 'src/lib/locale-node';
import { SUPPORTED_EDITORS, SupportedEditor } from 'src/modules/user-settings/lib/editor';
import { SupportedTerminal } from 'src/modules/user-settings/lib/terminal';
import { UserSettingsTabName } from 'src/modules/user-settings/user-settings-types';
import { defaultSitePath, ensureWritableDirectory } from 'src/storage/paths';
import {
	loadUserData,
	lockAppdata,
	saveUserData,
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

export async function getAgenticFeaturesEnabled(): Promise< boolean > {
	const userData = await loadUserData();
	return userData.agenticFeaturesEnabled ?? true;
}

export async function saveAgenticFeaturesEnabled(
	event: IpcMainInvokeEvent,
	enabled: boolean
): Promise< void > {
	await updateAppdata( { agenticFeaturesEnabled: enabled } );
}

export async function getColorScheme(): Promise< 'system' | 'light' | 'dark' > {
	const userData = await loadUserData();
	// Follow the OS appearance until the user explicitly picks a scheme.
	const colorScheme = userData.colorScheme ?? 'system';
	nativeTheme.themeSource = colorScheme;
	return colorScheme;
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

// Persistent-message dismissals (agentic UI update cards, announcements).
// Ids are opaque to the desktop; the renderer owns their meaning.
export async function getDismissedMessages(): Promise< string[] > {
	const userData = await loadUserData();
	return userData.dismissedMessages ?? [];
}

export async function dismissMessage( _event: IpcMainInvokeEvent, id: string ): Promise< void > {
	if ( typeof id !== 'string' || ! id ) {
		return;
	}
	await lockAppdata();
	try {
		const userData = await loadUserData();
		const dismissed = userData.dismissedMessages ?? [];
		if ( ! dismissed.includes( id ) ) {
			await saveUserData( { ...userData, dismissedMessages: [ ...dismissed, id ] } );
		}
	} finally {
		await unlockAppdata();
	}
}

export function showUserSettings( event: IpcMainInvokeEvent, tabName?: UserSettingsTabName ) {
	const parentWindow = BrowserWindow.fromWebContents( event.sender );
	sendIpcEventToRendererWithWindow( parentWindow, 'user-settings', { tabName } );
}
