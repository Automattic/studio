import type { WebContents } from 'electron';

// Keys pressed in the site preview go to its own page, so ⌘K (Ctrl+K
// elsewhere) is handed to the window, where it opens the command palette.
export function forwardPreviewCommandPalette(
	guest: WebContents,
	input: Electron.Input,
	platform: NodeJS.Platform = process.platform
) {
	const primary =
		platform === 'darwin' ? input.meta && ! input.control : input.control && ! input.meta;
	const host = guest.hostWebContents;
	if (
		input.type !== 'keyDown' ||
		input.code !== 'KeyK' ||
		input.isAutoRepeat ||
		input.isComposing ||
		input.alt ||
		input.shift ||
		! primary ||
		! host ||
		host.isDestroyed()
	) {
		return false;
	}
	host.focus();
	host.sendInputEvent( {
		type: 'keyDown',
		keyCode: 'K',
		modifiers: [ platform === 'darwin' ? 'meta' : 'control' ],
	} );
	return true;
}
