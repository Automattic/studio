import { BrowserWindow, IpcMainInvokeEvent, nativeTheme } from 'electron';
import { DEFAULT_MODEL, isAiModelId, type AiModelId } from '@studio/common/ai/models';
import {
	DEFAULT_RESPONSE_LENGTH,
	isAiResponseLength,
	type AiResponseLength,
} from '@studio/common/ai/response-length';
import {
	supportsAlwaysAllow,
	type ToolPermissionLevel,
	type ToolPermissionOverrides,
} from '@studio/common/ai/tool-permissions';
import {
	resolveActivitySoundPreferences,
	type ActivitySoundPreferences,
} from '@studio/common/lib/activity-sounds';
import {
	lockSharedConfig,
	readSharedConfig,
	saveSharedConfig,
	unlockSharedConfig,
	updateSharedConfig,
} from '@studio/common/lib/shared-config';
import { DEFAULT_TERMINAL } from 'src/constants';
import { sendIpcEventToRenderer, sendIpcEventToRendererWithWindow } from 'src/ipc-utils';
import { isInstalled } from 'src/lib/is-installed';
import { getUserLocaleWithFallback } from 'src/lib/locale-node';
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

// Lives in shared.json (not app.json) because the CLI reads it on every
// agent turn — see `resolveResponseLength` in `apps/cli/commands/ai/index.ts`.
export async function getAgentResponseLength(): Promise< AiResponseLength > {
	try {
		const config = await readSharedConfig();
		return config.agentResponseLength ?? DEFAULT_RESPONSE_LENGTH;
	} catch {
		return DEFAULT_RESPONSE_LENGTH;
	}
}

export async function saveAgentResponseLength(
	event: IpcMainInvokeEvent,
	responseLength: AiResponseLength
): Promise< void > {
	if ( ! isAiResponseLength( responseLength ) ) {
		throw new Error( `Unknown agent response length: ${ responseLength }` );
	}
	await updateSharedConfig( { agentResponseLength: responseLength } );
}

// Lives in shared.json (not app.json) because the CLI's permission extension
// reads it on every gated tool call — see apps/cli/ai/permissions/policy.ts.
export async function getToolPermissions(): Promise< ToolPermissionOverrides > {
	try {
		const config = await readSharedConfig();
		return ( config.toolPermissions ?? {} ) as ToolPermissionOverrides;
	} catch {
		return {};
	}
}

export async function saveToolPermission(
	event: IpcMainInvokeEvent,
	toolName: string,
	level: ToolPermissionLevel
): Promise< void > {
	if ( ! supportsAlwaysAllow( toolName ) ) {
		throw new Error( `Tool permission for ${ toolName } is not configurable` );
	}
	if ( level !== 'allow' && level !== 'ask' ) {
		throw new Error( `Unknown tool permission level: ${ level }` );
	}
	// Read + merge + write under the shared-config lock: the nested map merge
	// must not race a concurrent "Always allow" write from the CLI.
	await lockSharedConfig();
	try {
		const config = await readSharedConfig();
		await saveSharedConfig( {
			...config,
			toolPermissions: { ...config.toolPermissions, [ toolName ]: level },
		} );
	} finally {
		await unlockSharedConfig();
	}
}

// Lives in shared.json (not app.json) because the CLI reads it when a new
// session starts — see `resolveDefaultModel` in `apps/cli/commands/ai/index.ts`.
export async function getDefaultAiModel(): Promise< AiModelId > {
	try {
		const config = await readSharedConfig();
		return config.defaultAiModel ?? DEFAULT_MODEL;
	} catch {
		return DEFAULT_MODEL;
	}
}

export async function saveDefaultAiModel(
	event: IpcMainInvokeEvent,
	model: AiModelId
): Promise< void > {
	if ( ! isAiModelId( model ) ) {
		throw new Error( `Unknown AI model: ${ model }` );
	}
	await updateSharedConfig( { defaultAiModel: model } );
}

export async function getChatNotificationsEnabled(): Promise< boolean > {
	const userData = await loadUserData();
	return userData.chatNotificationsEnabled ?? true;
}

export async function saveChatNotificationsEnabled(
	event: IpcMainInvokeEvent,
	enabled: boolean
): Promise< void > {
	await updateAppdata( { chatNotificationsEnabled: enabled } );
}

export async function getActivitySoundPreferences(): Promise< ActivitySoundPreferences > {
	const userData = await loadUserData();
	return resolveActivitySoundPreferences( userData.activitySoundPreferences );
}

export async function saveActivitySoundPreferences(
	_event: IpcMainInvokeEvent,
	preferences: ActivitySoundPreferences
): Promise< void > {
	await updateAppdata( {
		activitySoundPreferences: resolveActivitySoundPreferences( preferences ),
	} );
}

export async function getColorScheme(): Promise< 'system' | 'light' | 'dark' > {
	const userData = await loadUserData();
	// Follow the OS appearance until the user explicitly picks a scheme.
	const colorScheme = userData.colorScheme ?? 'system';
	nativeTheme.themeSource = colorScheme;
	return colorScheme;
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

// Agentic UI onboarding state (orientation tour, getting-started checklist).
// The blob is opaque to the desktop; the renderer owns its meaning.
export async function getOnboardingHints(): Promise< OnboardingHintsState > {
	const userData = await loadUserData();
	return userData.onboardingHints ?? {};
}

export async function saveOnboardingHints(
	_event: IpcMainInvokeEvent,
	partial: Partial< OnboardingHintsState >
): Promise< void > {
	if ( ! partial || typeof partial !== 'object' ) {
		return;
	}
	await lockAppdata();
	try {
		const userData = await loadUserData();
		const current = userData.onboardingHints ?? {};
		// Shallow-merge, but merge completedItems by key so concurrent item
		// completions never clobber one another.
		const merged: OnboardingHintsState = {
			...current,
			...partial,
			completedItems: {
				...( current.completedItems ?? {} ),
				...( partial.completedItems ?? {} ),
			},
		};
		await saveUserData( { ...userData, onboardingHints: merged } );
	} finally {
		await unlockAppdata();
	}
}

export function showUserSettings( event: IpcMainInvokeEvent, tabName?: UserSettingsTabName ) {
	const parentWindow = BrowserWindow.fromWebContents( event.sender );
	sendIpcEventToRendererWithWindow( parentWindow, 'user-settings', { tabName } );
}
