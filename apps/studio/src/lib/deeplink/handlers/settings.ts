import { parseSettingsLink } from '@studio/common/lib/settings-link';
import { sendIpcEventToRenderer } from 'src/ipc-utils';
import { getMainWindow } from 'src/main-window';

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
	const mainWindow = await getMainWindow();
	if ( mainWindow.isMinimized() ) {
		mainWindow.restore();
	}
	mainWindow.focus();
	void sendIpcEventToRenderer( 'user-settings', { settingId: target.id } );
}
