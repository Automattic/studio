import { sendIpcEventToRenderer } from 'src/ipc-utils';
import { getMainWindow } from 'src/main-window';

/**
 * Handles the wp-studio://ai-credits-purchased deeplink, which WordPress.com
 * checkout redirects to once an AI credits top-up completes (or is cancelled).
 * Brings Studio back to the front and lets the renderer show the new balance —
 * both front ends open their usage settings and refetch the quota, since
 * nothing else invalidates it while the window sits in the background.
 */
export async function handleAiCreditsPurchasedDeeplink(): Promise< void > {
	const mainWindow = await getMainWindow();
	if ( mainWindow.isMinimized() ) {
		mainWindow.restore();
	}
	mainWindow.focus();

	void sendIpcEventToRenderer( 'ai-credits-purchased' );
}
