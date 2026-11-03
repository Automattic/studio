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
	const annotation = input.code === 'Period' && input.shift;
	if (
		input.type !== 'keyDown' ||
		( input.code !== 'KeyK' && ! annotation ) ||
		input.isAutoRepeat ||
		input.isComposing ||
		input.alt ||
		( input.shift && ! annotation ) ||
		! primary ||
		! host ||
		host.isDestroyed()
	) {
		return false;
	}
	host.focus();
	host.sendInputEvent( {
		type: 'keyDown',
		keyCode: annotation ? '.' : 'K',
		modifiers: [
			platform === 'darwin' ? 'meta' : 'control',
			...( annotation ? [ 'shift' as const ] : [] ),
		],
	} );
	return true;
}
