import { parseSettingsLink } from '@studio/common/lib/settings-link';
import { sendIpcEventToRenderer } from 'src/ipc-utils';
import { getMainWindow } from 'src/main-window';

// Kept until the renderer takes it, since a link can arrive before it listens.
let pendingSettingId: string | null = null;

export function takePendingSettingsLink(): string | null {
	const settingId = pendingSettingId;
	pendingSettingId = null;
	return settingId;
}

/**
 * Handles wp-studio://app/v1/settings?id=<setting>, a link copied from a
 * setting's title. The renderer opens Settings on that setting's section.
 */
export async function handleSettingsDeeplink( urlObject: URL ): Promise< void > {
	const target = parseSettingsLink( urlObject.href );
	if ( ! target ) {
		console.warn( `Invalid settings link: ${ urlObject.href }` );
		return;
	}
	pendingSettingId = target.id;
	const mainWindow = await getMainWindow();
	if ( mainWindow.isMinimized() ) {
		mainWindow.restore();
	}
	mainWindow.focus();
	void sendIpcEventToRenderer( 'user-settings', { settingId: target.id } );
}
