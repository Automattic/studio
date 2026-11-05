import { sendIpcEventToRenderer } from 'src/ipc-utils';
import { parseStudioActionLink } from 'src/lib/deeplink/studio-action-link';
import { getMainWindow } from 'src/main-window';

export async function handleStudioActionDeeplink( url: URL ): Promise< void > {
	const target = parseStudioActionLink( url.href );
	if ( ! target ) {
		return;
	}
	const window = await getMainWindow();
	if ( window.isMinimized() ) {
		window.restore();
	}
	window.show();
	window.focus();
	if ( target.action === 'new-site' ) {
		await sendIpcEventToRenderer( 'add-site' );
	} else {
		await sendIpcEventToRenderer( 'open-site', { siteId: target.siteId } );
	}
}
