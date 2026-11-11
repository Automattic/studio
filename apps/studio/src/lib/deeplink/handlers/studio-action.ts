import { sendIpcEventToRenderer } from 'src/ipc-utils';
import { parseStudioActionLink } from 'src/lib/deeplink/studio-action-link';
import { getMainWindow } from 'src/main-window';
import { handleImportSite } from './import-site';

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
	if ( target.action === 'import-site' ) {
		await handleImportSite( target, window );
	} else if ( target.action === 'new-site' ) {
		await sendIpcEventToRenderer( 'add-site' );
	} else if ( target.action === 'pull-site' ) {
		await sendIpcEventToRenderer( 'pull-site', { remoteSiteId: target.remoteSiteId } );
	} else {
		await sendIpcEventToRenderer( 'open-site', { siteId: target.siteId } );
	}
}
