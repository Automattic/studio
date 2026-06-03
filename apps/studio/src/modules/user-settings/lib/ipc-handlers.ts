import { BrowserWindow, IpcMainInvokeEvent, nativeTheme } from 'electron';
import { updateSharedConfig } from '@studio/common/lib/shared-config';
import {
	DEFAULT_MESSAGE_SEND_SHORTCUT,
	isMessageSendShortcut,
	type MessageSendShortcut,
} from '@studio/common/lib/user-settings/message-send-shortcut';
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
import type { WpAdminOpenTarget } from 'src/storage/storage-types';

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

export async function saveMessageSendShortcut(
	_event: IpcMainInvokeEvent,
	messageSendShortcut: MessageSendShortcut
) {
	if ( ! isMessageSendShortcut( messageSendShortcut ) ) {
		throw new Error( 'Invalid message send shortcut' );
	}
	await updateAppdata( { messageSendShortcut } );
}

export async function getMessageSendShortcut(): Promise< MessageSendShortcut > {
	const userData = await loadUserData();
	return isMessageSendShortcut( userData.messageSendShortcut )
		? userData.messageSendShortcut
		: DEFAULT_MESSAGE_SEND_SHORTCUT;
}

function isWpAdminOpenTarget( value: unknown ): value is WpAdminOpenTarget {
	return value === 'default-browser' || value === 'studio-browser';
}

export async function saveWpAdminOpenTarget(
	_event: IpcMainInvokeEvent,
	wpAdminOpenTarget: WpAdminOpenTarget
) {
	if ( ! isWpAdminOpenTarget( wpAdminOpenTarget ) ) {
		throw new Error( 'Invalid WP Admin open target' );
	}
	await updateAppdata( { wpAdminOpenTarget } );
}

export async function getWpAdminOpenTarget(): Promise< WpAdminOpenTarget > {
	const userData = await loadUserData();
	return isWpAdminOpenTarget( userData.wpAdminOpenTarget )
		? userData.wpAdminOpenTarget
		: 'default-browser';
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

export function showUserSettings( event: IpcMainInvokeEvent, tabName?: UserSettingsTabName ) {
	const parentWindow = BrowserWindow.fromWebContents( event.sender );
	sendIpcEventToRendererWithWindow( parentWindow, 'user-settings', { tabName } );
}
