import { webContents, type WebContents } from 'electron';

export type AppZoomCommand = 'reset' | 'in' | 'out';

export function getAppZoomCommand(
	input: Electron.Input,
	platform: NodeJS.Platform = process.platform
): AppZoomCommand | null {
	if ( input.type !== 'keyDown' || input.isComposing || input.alt ) {
		return null;
	}

	const hasPrimaryModifier =
		platform === 'darwin' ? input.meta && ! input.control : input.control && ! input.meta;
	if ( ! hasPrimaryModifier ) {
		return null;
	}

	if ( input.key === '+' || input.key === '=' ) {
		return 'in';
	}
	if ( input.key === '-' || input.key === '_' ) {
		return 'out';
	}
	if ( input.key === '0' && ! input.shift ) {
		return 'reset';
	}

	return null;
}

export function applyAppZoomCommand( contents: WebContents, command: AppZoomCommand ) {
	if ( command === 'reset' ) {
		contents.setZoomLevel( 0 );
	} else {
		contents.setZoomLevel( contents.getZoomLevel() + ( command === 'in' ? 0.5 : -0.5 ) );
	}

	for ( const guest of getHostedWebviews( contents ) ) {
		resetPreviewZoom( guest );
	}
}

/**
 * Pins a site-preview `<webview>` back to 1:1.
 *
 * Electron copies an embedder's zoom level onto its guests: immediately when
 * the embedder zooms, and again on each guest navigation. The app's zoom is
 * for the surrounding UI only — the preview simulates real viewports, so its
 * guests always render unzoomed.
 */
export function resetPreviewZoom( guest: WebContents ) {
	if ( guest.isDestroyed() || guest.getZoomLevel() === 0 ) {
		return;
	}
	guest.setZoomLevel( 0 );
}

function getHostedWebviews( host: WebContents ): WebContents[] {
	return webContents
		.getAllWebContents()
		.filter(
			( contents ) => contents.getType() === 'webview' && contents.hostWebContents?.id === host.id
		);
}
