import { AI_CREDITS_PURCHASED_RETURN_TO } from '@studio/common/lib/studio-assistant-quota';
import { sendIpcEventToRenderer } from 'src/ipc-utils';
import { getMainWindow } from 'src/main-window';

/**
 * Handles the wp-studio://checkout-return deeplink that WordPress.com checkout
 * sends once a purchase completes or is cancelled. `studioReturnTo` echoes back
 * the value Studio put on the checkout URL, saying which flow to resume.
 *
 * An AI credits top-up is the only checkout Studio opens today, so a missing
 * `studioReturnTo` is treated as that rather than dropped — better to refresh
 * the balance for nothing than to strand the user in the browser.
 */
export async function handleCheckoutReturnDeeplink( urlObject: URL ): Promise< void > {
	const returnTo = urlObject.searchParams.get( 'studioReturnTo' );
	if ( returnTo && returnTo !== AI_CREDITS_PURCHASED_RETURN_TO ) {
		console.warn( `Unknown checkout return destination: ${ returnTo }` );
		return;
	}

	const mainWindow = await getMainWindow();
	if ( mainWindow.isMinimized() ) {
		mainWindow.restore();
	}
	mainWindow.focus();

	void sendIpcEventToRenderer( 'ai-credits-purchased' );
}
